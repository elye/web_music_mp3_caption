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
    parser.add_argument("--offline", action="store_true", help="Never contact a package or model registry.")
    parser.add_argument("--wheels", type=Path, help="Folder of Python wheels prepared for this OS/Python version.")
    args = parser.parse_args()
    if not (3, 10) <= sys.version_info[:2] <= (3, 13):
        raise RuntimeError("Use Python 3.10–3.13 for the local transcription runtime.")
    model_dir = LOCAL / "models" / args.model
    if args.offline and any(not (model_dir / name).is_file() for name in FILES):
        raise RuntimeError(f"Offline setup needs model files copied to {model_dir} first. See README.md.")
    print("Preparing a project-local Python environment. Global Python is not changed.", flush=True)
    environment = LOCAL / "venv"
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    env = {**os.environ, "PIP_CACHE_DIR": str(LOCAL / "cache" / "pip"),
           "HF_HOME": str(LOCAL / "cache" / "huggingface"), "HF_HUB_DISABLE_TELEMETRY": "1",
           "DO_NOT_TRACK": "1", "PIP_DISABLE_PIP_VERSION_CHECK": "1", "PYTHONNOUSERSITE": "1"}
    if args.offline:
        env.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
    install = [str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
               "-r", str(ROOT / "server" / "requirements-local.txt")]
    if args.offline:
        install.append("--no-index")
    if args.wheels:
        install.extend(["--find-links", str(args.wheels.resolve())])
    subprocess.run(install, env=env, check=True)
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
    config = LOCAL / "config.json"
    temporary = config.with_suffix(".tmp")
    temporary.write_text(json.dumps({"model": args.model}, indent=2) + "\n")
    temporary.replace(config)
    print(f"\nReady: local Whisper {args.model}. Run pnpm dev, or pnpm build && pnpm start.", flush=True)
    print("Internet is no longer needed for playback or transcription. No API key is required.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print(f"\nLocal setup did not complete: {error}", file=sys.stderr)
        sys.exit(1)
