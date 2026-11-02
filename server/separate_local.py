"""CPU-only, offline-only vocal remover ("minus-one"). Writes an MP3 and prints one JSON result.

The mix is separated into drums, bass, other and vocals by Demucs; everything except
the vocals is summed into the backing track.
"""
import argparse
import json
import math
import os
from pathlib import Path
import socket
import sys

os.environ.update({
    "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "DO_NOT_TRACK": "1",
})


def deny_network(*_args, **_kwargs):
    raise RuntimeError("Network access is disabled in the local separation worker.")


# Fail closed if a dependency ever attempts a network request or DNS lookup.
socket.create_connection = deny_network
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.getaddrinfo = deny_network

SAMPLE_RATE = 44100
MAX_SECONDS = 15 * 60 + 1
MODELS = ("htdemucs",)


def decode(path):
    """Decode any container PyAV understands to float32 stereo at 44.1 kHz, shape (2, samples)."""
    import av
    import numpy as np

    chunks = []
    total = 0
    with av.open(str(path)) as container:
        if not container.streams.audio:
            raise ValueError("The file has no audio track.")
        resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SAMPLE_RATE)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                block = converted.to_ndarray()[:, : converted.samples]
                total += block.shape[1]
                if total > MAX_SECONDS * SAMPLE_RATE:
                    raise ValueError("Audio is longer than the 15 minute limit.")
                chunks.append(block)
        for converted in resampler.resample(None):
            block = converted.to_ndarray()[:, : converted.samples]
            total += block.shape[1]
            chunks.append(block)
    if not total:
        raise ValueError("The file contains no audio.")
    return np.concatenate(chunks, axis=1).astype("float32", copy=False)


def encode_mp3(samples, path, bitrate=192):
    """Write float32 stereo samples, shape (2, n), as MP3 using the LAME encoder bundled with Demucs."""
    import lameenc
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").T.copy()
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(2)
    encoder.set_quality(2)
    with open(path, "wb") as output:
        step = SAMPLE_RATE * 30
        for start in range(0, pcm.shape[0], step):
            output.write(encoder.encode(pcm[start:start + step].tobytes()))
        output.write(encoder.flush())


def load_model(name):
    import torch
    from demucs.pretrained import get_model

    # TORCH_HOME points at the project-local cache. A missing file would otherwise try a download,
    # which the network guard above turns into an error.
    model = get_model(name)
    model.eval()
    return model, torch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="htdemucs", choices=MODELS)
    parser.add_argument("--audio")
    parser.add_argument("--output")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    model, torch = load_model(args.model)
    torch.set_num_threads(max(1, min(16, args.threads)))
    from demucs.apply import apply_model

    if args.check:
        # Run the real model on one second of noise, not just load the weights.
        sample = torch.randn(1, model.audio_channels, model.samplerate) * 0.01
        with torch.no_grad():
            apply_model(model, sample, device="cpu", split=True, progress=False)
        print(json.dumps({"ready": True, "engine": "demucs", "model": args.model, "offline": True}))
        return

    if not args.audio or not args.output:
        raise ValueError("--audio and --output are required.")
    mix = torch.from_numpy(decode(args.audio))
    duration = mix.shape[1] / SAMPLE_RATE
    # Demucs expects input normalised to the mix's own mean and deviation.
    reference = mix.mean(0)
    mean, std = reference.mean(), reference.std()
    if not math.isfinite(float(std)) or float(std) < 1e-8:
        raise ValueError("The audio is silent.")
    with torch.no_grad():
        stems = apply_model(model, ((mix - mean) / std)[None], device="cpu", split=True,
                            overlap=0.25, shifts=0, progress=False, num_workers=0)[0]
    stems = stems * std + mean
    names = list(model.sources)
    if "vocals" not in names:
        raise ValueError("The model has no vocals stem.")
    backing = sum(stems[i] for i, name in enumerate(names) if name != "vocals")
    peak = float(backing.abs().max())
    if peak > 0.99:
        backing = backing * (0.99 / peak)  # Avoid clipping when stems sum above full scale.
    encode_mp3(backing.numpy(), args.output)
    print(json.dumps({"duration": duration, "model": args.model, "local": True}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # The parent returns a friendly error; audio content is never logged.
        print(f"Local vocal removal failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
