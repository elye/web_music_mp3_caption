"""Convert a local MP4 audio track to MP3 using PyAV, without network access."""
import argparse
import json
import os
import socket
import sys

os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "DO_NOT_TRACK": "1"})


def deny_network(*_args, **_kwargs):
    raise RuntimeError("Network access is disabled in the local MP3 worker.")


socket.create_connection = deny_network
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.getaddrinfo = deny_network


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    import av
    av.codec.Codec("libmp3lame", "w")
    if args.check:
        print(json.dumps({"ready": True, "local": True}))
        return
    if not args.input or not args.output:
        raise ValueError("Input and output paths are required.")

    with av.open(args.input, mode="r", options={"protocol_whitelist": "file"}) as source:
        if "mp4" not in source.format.name.split(","):
            raise ValueError("Invalid MP4 container.")
        if not source.streams.audio:
            raise ValueError("The MP4 has no audio track.")
        with av.open(args.output, mode="w", format="mp3") as output:
            stream = output.add_stream("libmp3lame", rate=44100)
            stream.layout = "stereo"
            stream.bit_rate = 192000
            resampler = av.AudioResampler(format="fltp", layout="stereo", rate=44100)
            samples = 0

            def encode(frames):
                nonlocal samples
                for frame in frames:
                    samples += frame.samples
                    frame.pts = None
                    for packet in stream.encode(frame):
                        output.mux(packet)

            for frame in source.decode(source.streams.audio[0]):
                encode(resampler.resample(frame))
            encode(resampler.resample(None))
            if not samples:
                raise ValueError("The MP4 has no audio samples.")
            for packet in stream.encode(None):
                output.mux(packet)
    print(json.dumps({"local": True}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Local MP3 conversion failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
