import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalTranscriber, offlineEnvironment } from './local-transcriber.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.LOCAL_WHISPER_PYTHON || join(root, '.local-transcription/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const transcriber = createLocalTranscriber();

function silence() {
  const buffer = Buffer.alloc(44 + 16000 * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}

test('installed model performs real CPU inference with offline-only loading', { timeout: 120000 }, async () => {
  assert.equal((await transcriber.status()).transcriptionAvailable, true, 'Run pnpm setup:local first; this test never downloads a model.');
  const result = await transcriber.transcribe({ buffer: silence(), language: 'en' });
  assert.equal(result.local, true);
  assert.ok(Array.isArray(result.lyrics));
});

test('the actual Python worker refuses socket connections and DNS lookups', async () => {
  const code = `import runpy, socket, os
runpy.run_path(${JSON.stringify(join(root, 'server/transcribe_local.py'))}, run_name='offline_test')
assert os.environ['HF_HUB_OFFLINE'] == '1'
assert os.environ['TRANSFORMERS_OFFLINE'] == '1'
blocked = 0
for operation in [lambda: socket.create_connection(('example.com',443)), lambda: socket.getaddrinfo('example.com',443), lambda: socket.socket().connect(('127.0.0.1',1))]:
    try: operation()
    except RuntimeError: blocked += 1
assert blocked == 3
print('All three network attempts were blocked before connection.')`;
  const { stdout } = await run(python, ['-c', code], { env: offlineEnvironment() });
  assert.match(stdout, /All three network attempts were blocked/);
});

test('recognizes locally synthesized speech without any cloud service', { timeout: 120000 }, async (context) => {
  if (process.platform !== 'darwin') { context.skip('Optional speech fixture uses the macOS installed Samantha voice.'); return; }
  const temp = await mkdtemp(join(tmpdir(), 'chorus-local-speech-'));
  try {
    try {
      await run('/usr/bin/say', ['-v', 'Samantha', '-o', join(temp, 'speech.aiff'), 'Welcome to our singing group. Every voice has a place in this song. We can sing together.'], { timeout: 20000 });
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(temp, 'speech.aiff'), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', join(temp, 'speech.wav')]);
    } catch {
      context.skip('Install a local Samantha voice and ffmpeg to run the optional spoken fixture test. No voice is downloaded by this test.');
      return;
    }
    const start = performance.now();
    const result = await transcriber.transcribe({ buffer: await readFile(join(temp, 'speech.wav')), language: 'en' });
    const text = result.lyrics.map((line) => line.text).join(' ');
    assert.match(text, /sing|voice|welcome|group/i);
    assert.ok(result.lyrics.every((line) => line.start >= 0 && line.end > line.start));
    console.log(`Local speech recognized in ${((performance.now() - start) / 1000).toFixed(1)}s: ${text}`);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
