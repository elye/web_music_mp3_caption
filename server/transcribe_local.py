"""CPU-only, offline-only Whisper worker. Outputs one JSON result to stdout."""
import argparse
import io
import json
import logging
import math
import os
from pathlib import Path
import socket
import sys
import wave

# Set before any recognition libraries are imported. Never download at runtime.
os.environ.update({
    "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "DO_NOT_TRACK": "1",
})


def deny_network(*_args, **_kwargs):
    raise RuntimeError("Network access is disabled in the local transcription worker.")


# Fail closed if a Python dependency ever attempts a network request or DNS lookup.
socket.create_connection = deny_network
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.getaddrinfo = deny_network

REQUIRED_MODEL_FILES = ("model.bin", "config.json", "tokenizer.json")


def validate_model(directory):
    path = Path(directory).resolve()
    if not path.is_dir() or any(not (path / name).is_file() for name in REQUIRED_MODEL_FILES):
        raise ValueError("The local model is incomplete. Run pnpm setup:local before transcribing.")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--audio")
    parser.add_argument("--language", default="")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = validate_model(args.model)
    duration = None
    if not args.check:
        if not args.audio:
            raise ValueError("A local PCM WAV file is required.")
        with wave.open(args.audio, "rb") as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                raise ValueError("Audio must be 16 kHz mono PCM WAV.")
            duration = audio.getnframes() / audio.getframerate()
            if duration <= 0 or duration > 361:
                raise ValueError("Audio chunks must contain no more than six minutes of audio.")
    from faster_whisper import WhisperModel
    logging.getLogger("faster_whisper").setLevel(logging.ERROR)
    model = WhisperModel(
        str(path), device="cpu", compute_type="int8",
        cpu_threads=max(1, min(16, args.threads)), num_workers=1,
        local_files_only=True,
    )
    if args.check:
        # Check decoding and inference too, not just whether model weights can load.
        sample = io.BytesIO()
        with wave.open(sample, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b"\0" * 32000)
        sample.seek(0)
        segments, _ = model.transcribe(sample, language="en", beam_size=1, vad_filter=False)
        list(segments)
        print(json.dumps({"ready": True, "engine": "faster-whisper", "offline": True}))
        return
    segments, info = model.transcribe(
        args.audio, language=args.language or None, task="transcribe",
        beam_size=5, vad_filter=False, condition_on_previous_text=False,
        word_timestamps=False,
    )
    lyrics = []
    for segment in segments:
        text = segment.text.strip()
        start, end = max(0, segment.start), min(duration, segment.end)
        if text and math.isfinite(start) and math.isfinite(end) and start < end:
            lyrics.append({"start": start, "end": end, "text": text})
    print(json.dumps({"lyrics": lyrics, "language": info.language, "local": True}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # The parent returns a friendly error; no audio or transcripts are logged.
        print(f"Local transcription failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
