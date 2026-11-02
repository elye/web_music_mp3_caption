"""Explicit one-time setup. This is the only component that downloads models."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / ".local-transcription"
MODELS = ("tiny", "base", "small", "medium")
FILES = ("model.bin", "config.json", "tokenizer.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=MODELS, default="base", help="Multilingual Whisper model (default: base, about 145 MB).")
    parser.add_argument("--skip-transcription", action="store_true", help="Do not install or change the Whisper lyrics model.")
    parser.add_argument("--skip-minus-one", action="store_true", help="Do not install the Demucs vocal remover (about 1 GB with PyTorch).")
    parser.add_argument("--offline", action="store_true", help="Never contact a package or model registry.")
    parser.add_argument("--wheels", type=Path, help="Folder of Python wheels prepared for this OS/Python version.")
    args = parser.parse_args()
    if not (3, 10) <= sys.version_info[:2] <= (3, 13):
        raise RuntimeError("Use Python 3.10–3.13 for the local transcription runtime.")
    if args.skip_transcription and args.skip_minus_one:
        raise RuntimeError("Nothing to install: both --skip-transcription and --skip-minus-one were given.")
    model_dir = LOCAL / "models" / args.model
    torch_home = LOCAL / "cache" / "torch"
    if args.offline and not args.skip_minus_one and not list((torch_home / "hub" / "checkpoints").glob("*.th")):
        raise RuntimeError(f"Offline setup needs the Demucs weights copied to {torch_home / 'hub' / 'checkpoints'} first. See README.md.")
    if args.offline and not args.skip_transcription and any(not (model_dir / name).is_file() for name in FILES):
        raise RuntimeError(f"Offline setup needs model files copied to {model_dir} first. See README.md.")
    print("Preparing a project-local Python environment. Global Python is not changed.", flush=True)
    environment = LOCAL / "venv"
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    env = {**os.environ, "PIP_CACHE_DIR": str(LOCAL / "cache" / "pip"),
           "HF_HOME": str(LOCAL / "cache" / "huggingface"), "TORCH_HOME": str(torch_home), "HF_HUB_DISABLE_TELEMETRY": "1",
           "DO_NOT_TRACK": "1", "PIP_DISABLE_PIP_VERSION_CHECK": "1", "PYTHONNOUSERSITE": "1"}
    if args.offline:
        env.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
    def pip_install(requirements):
        install = [str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
                   "-r", str(ROOT / "server" / requirements)]
        if args.offline:
            install.append("--no-index")
        if args.wheels:
            install.extend(["--find-links", str(args.wheels.resolve())])
        subprocess.run(install, env=env, check=True)

    config = LOCAL / "config.json"

    def save_config(**values):
        # Merge so setting up one feature never forgets the other.
        try:
            current = json.loads(config.read_text())
        except (OSError, ValueError):
            current = {}
        temporary = config.with_suffix(".tmp")
        temporary.write_text(json.dumps({**current, **values}, indent=2) + "\n")
        temporary.replace(config)

    pip_install("requirements-local.txt")
    if not args.skip_transcription:
        if not args.offline:
            print(f"Downloading the multilingual '{args.model}' model once. No songs are sent anywhere.", flush=True)
            code = (
                "from huggingface_hub import snapshot_download; import sys; "
                "snapshot_download(repo_id='Systran/faster-whisper-' + sys.argv[1], "
                "local_dir=sys.argv[2], token=False, "
                "allow_patterns=['model.bin','config.json','tokenizer.json','preprocessor_config.json','vocabulary.*'], max_workers=2)"
            )
            subprocess.run([str(python), "-c", code, args.model, str(model_dir)], env=env, check=True)
        print("Verifying that the model loads with network access disabled…", flush=True)
        subprocess.run([str(python), str(ROOT / "server" / "transcribe_local.py"), "--model", str(model_dir), "--check"], env=env, check=True)
        # Only select this model after a successful offline load. Failed upgrades keep the old selection.
        save_config(model=args.model)
        print(f"Ready: local Whisper {args.model}.", flush=True)
    if not args.skip_minus_one:
        print("Installing the vocal remover (PyTorch + Demucs). This is a large one-time download.", flush=True)
        pip_install("requirements-minus-one.txt")
        if not args.offline:
            print("Downloading the Demucs htdemucs weights once (about 84 MB). No songs are sent anywhere.", flush=True)
            code = "from demucs.pretrained import get_model; get_model('htdemucs')"
            subprocess.run([str(python), "-c", code], env=env, check=True)
        print("Verifying that the vocal remover runs with network access disabled…", flush=True)
        subprocess.run([str(python), str(ROOT / "server" / "separate_local.py"), "--model", "htdemucs", "--check"], env=env, check=True)
        save_config(minusOne="htdemucs")
        print("Ready: local Demucs vocal remover (minus-one).", flush=True)
    print("\nRun pnpm dev, or pnpm build && pnpm start.", flush=True)
    print("Internet is no longer needed for playback, transcription, or minus-one. No API key is required.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print(f"\nLocal setup did not complete: {error}", file=sys.stderr)
        sys.exit(1)
