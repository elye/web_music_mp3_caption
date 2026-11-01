import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const models = new Set(['tiny', 'base', 'small', 'medium']);
const boundedNumber = (value, fallback, min, max) => Number.isFinite(Number(value)) && Number(value) >= min ? Math.min(max, Number(value)) : fallback;

export function offlineEnvironment(root = projectRoot) {
  return {
    ...process.env,
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    HF_HOME: join(root, '.local-transcription', 'cache', 'huggingface'),
  };
}

export function createLocalTranscriber({ root = projectRoot, spawnImpl = spawn, timeoutMs } = {}) {
  const local = join(root, '.local-transcription');
  const timeout = timeoutMs ?? boundedNumber(process.env.LOCAL_WHISPER_TIMEOUT_SECONDS, 1200, 1, 7200) * 1000;
  const threads = Math.floor(boundedNumber(process.env.LOCAL_WHISPER_THREADS, 4, 1, 16));

  async function configuration() {
    const saved = await readFile(join(local, 'config.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    const model = process.env.LOCAL_WHISPER_MODEL || saved.model || 'base';
    if (!models.has(model)) throw new Error('Unsupported local model.');
    return {
      model,
      modelPath: join(local, 'models', model),
      python: process.env.LOCAL_WHISPER_PYTHON ? resolve(process.env.LOCAL_WHISPER_PYTHON) : join(local, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    };
  }

  async function status() {
    try {
      const config = await configuration();
      await access(config.python, constants.X_OK);
      await Promise.all(['model.bin', 'config.json', 'tokenizer.json'].map((file) => access(join(config.modelPath, file), constants.R_OK)));
      return { transcriptionAvailable: true, engine: 'faster-whisper', model: config.model, local: true, message: `Whisper ${config.model} · on this computer · CPU` };
    } catch {
      return { transcriptionAvailable: false, engine: 'faster-whisper', model: null, local: true, message: 'Run pnpm setup:local once to install the local runtime and model. There is no cloud fallback.' };
    }
  }

  async function transcribe({ buffer, language = '', signal }) {
    signal?.throwIfAborted();
    if (!(await status()).transcriptionAvailable) throw new Error('Local transcription is not set up. Run pnpm setup:local.');
    const { python, modelPath } = await configuration();
    const tempRoot = join(local, 'tmp');
    await mkdir(tempRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(tempRoot, 'audio-'));
    try {
      const audioPath = join(temporary, 'chunk.wav');
      await writeFile(audioPath, buffer, { mode: 0o600 });
      signal?.throwIfAborted();
      const args = [join(projectRoot, 'server', 'transcribe_local.py'), '--model', modelPath,
        '--audio', audioPath, '--language', language, '--threads', String(threads)];
      const output = await new Promise((resolveOutput, reject) => {
        const child = spawnImpl(python, args, { env: offlineEnvironment(root), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        let stdout = '';
        let stderr = '';
        let failure;
        let killTimer;
        const stop = (error) => {
          if (failure) return;
          failure = error;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
          killTimer.unref();
        };
        const abort = () => stop(new DOMException('Local transcription cancelled.', 'AbortError'));
        const timer = setTimeout(() => stop(new Error('Local transcription took too long. Try a smaller model, or increase LOCAL_WHISPER_TIMEOUT_SECONDS.')), timeout);
        timer.unref();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        child.stdout.on('data', (data) => {
          stdout += data.toString();
          if (stdout.length > 4 * 1024 * 1024) stop(new Error('The local transcription result was too large.'));
        });
        child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-16000); });
        child.once('error', () => { failure = new Error('Could not start the local Python runtime. Run pnpm setup:local again.'); });
        // Wait for close, not just abort, before releasing the job slot or removing its audio.
        child.once('close', (code) => {
          clearTimeout(timer); clearTimeout(killTimer);
          signal?.removeEventListener('abort', abort);
          if (failure) reject(failure);
          else if (code !== 0) reject(new Error(/16 kHz|WAV|wave\.Error|six minutes/i.test(stderr)
            ? 'The local worker requires a valid 16 kHz mono WAV chunk, no longer than six minutes.'
            : 'The local model could not transcribe this audio. Check the local installation with pnpm setup:local --offline.'));
          else resolveOutput(stdout);
        });
      });
      let result;
      try { result = JSON.parse(output); } catch { throw new Error('The local worker returned an invalid result.'); }
      if (!Array.isArray(result.lyrics)) throw new Error('The local worker returned no timed lyrics.');
      return result;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return { status, transcribe };
}
