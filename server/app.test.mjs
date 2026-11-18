import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp } from './app.mjs';

const ready = { transcriptionAvailable: true, engine: 'faster-whisper', model: 'small', local: true };
const worker = (transcribe = async () => ({ lyrics: [] }), separate = async () => ({ buffer: Buffer.from('ID3mp3'), duration: 1 })) => ({
  status: async () => ready,
  minusOneStatus: async () => ({ minusOneAvailable: true, minusOneModel: 'htdemucs' }),
  transcribe,
  separate,
  mp3Status: async () => ({ mp3Available: true }),
  convertMp3: async () => ({ buffer: Buffer.from('ID3converted') }),
});
const song = (type = 'audio/mpeg') => {
  const form = new FormData();
  form.append('audio', new Blob([Buffer.from('not really an mp3')], { type }), 'song.mp3');
  return form;
};

async function withServer(options, run) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
const body = (type = 'audio/wav', valid = true) => {
  const form = new FormData();
  const buffer = Buffer.alloc(48);
  if (valid) { buffer.write('RIFF'); buffer.write('WAVE', 8); }
  form.append('audio', new Blob([buffer], { type }), 'song.wav');
  return form;
};

test('missing local model disables transcription; there is no credential or cloud fallback', async () => {
  await withServer({ transcriber: { status: async () => ({ ...ready, transcriptionAvailable: false }), transcribe: () => assert.fail('Must not run') } }, async (url) => {
    const result = await fetch(`${url}/api/status`).then((r) => r.json());
    assert.equal(result.transcriptionAvailable, false);
    assert.equal(result.local, true);
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() })).status, 503);
  });
});

test('passes local audio to a local worker, validates timestamps, and preserves language', async () => {
  let requests = 0;
  await withServer({ transcriber: worker(async ({ buffer, language, signal }) => {
    requests++;
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
    assert.equal(language, 'en');
    assert.equal(signal.aborted, false);
    return { lyrics: [{ start: 1, end: 3, text: ' Hello ' }, { start: -2, end: 0, text: 'bad' }], language };
  }) }, async (url) => {
    const audio = body(); audio.append('language', 'en');
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', body: audio });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { lyrics: [{ start: 1, end: 3, text: 'Hello' }], language: 'en', local: true });
    assert.equal(requests, 1);
  });
});

test('rejects foreign browser origins before invoking the worker', async () => {
  await withServer({ transcriber: worker(() => assert.fail('Must not run')) }, async (url) => {
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: body() });
    assert.equal(response.status, 403);
  });
});

test('validates type and WAV signature, releases busy slot after invalid input, and sanitizes errors', async () => {
  await withServer({ transcriber: worker(() => { throw new Error('Private absolute path or internals'); }) }, async (url) => {
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: body('text/plain') })).status, 400);
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: body('audio/wav', false) })).status, 400);
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: new FormData() })).status, 400);
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() });
    assert.equal(response.status, 500);
    assert.ok(!(await response.json()).error.includes('Private'));
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).busy, false);
  });
});

test('accepts local browser origins', async () => {
  await withServer({ transcriber: worker() }, async (url) => {
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173' }, body: body() });
    assert.equal(response.status, 200);
  });
});

test('cancelled jobs remain busy until the worker has actually exited', async () => {
  let signal;
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const exited = new Promise((resolve) => { release = resolve; });
  await withServer({ transcriber: worker(async (input) => { signal = input.signal; started(); await exited; return { lyrics: [] }; }) }, async (url) => {
    const abort = new AbortController();
    const request = fetch(`${url}/api/transcribe`, { method: 'POST', body: body(), signal: abort.signal }).catch(() => {});
    await began;
    abort.abort();
    await wait(50);
    assert.equal(signal.aborted, true);
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).busy, true);
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() })).status, 429);
    release();
    await request;
    await wait(20);
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).busy, false);
  });
});

test('status reports whether the local vocal remover is installed', async () => {
  await withServer({ transcriber: worker() }, async (url) => {
    const result = await fetch(`${url}/api/status`).then((r) => r.json());
    assert.equal(result.minusOneAvailable, true);
    assert.equal(result.transcriptionAvailable, true);
  });
  await withServer({ transcriber: { status: async () => ready, transcribe: async () => ({ lyrics: [] }) } }, async (url) => {
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).minusOneAvailable, false);
  });
});

test('minus-one returns the local worker\'s MP3 and has no cloud fallback when not installed', async () => {
  let received;
  await withServer({ transcriber: worker(undefined, async ({ buffer, signal }) => {
    received = buffer.toString();
    assert.equal(signal.aborted, false);
    return { buffer: Buffer.from('ID3backing'), duration: 3 };
  }) }, async (url) => {
    const response = await fetch(`${url}/api/minus-one`, { method: 'POST', body: song() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'ID3backing');
    assert.equal(received, 'not really an mp3');
  });
  await withServer({ transcriber: { ...worker(), minusOneStatus: async () => ({ minusOneAvailable: false }), separate: () => assert.fail('Must not run') } }, async (url) => {
    assert.equal((await fetch(`${url}/api/minus-one`, { method: 'POST', body: song() })).status, 503);
  });
});

test('minus-one validates input, rejects foreign origins, sanitizes errors, and frees the slot', async () => {
  await withServer({ transcriber: worker(undefined, () => { throw new Error('Private absolute path or internals'); }) }, async (url) => {
    assert.equal((await fetch(`${url}/api/minus-one`, { method: 'POST', body: song('text/plain') })).status, 400);
    assert.equal((await fetch(`${url}/api/minus-one`, { method: 'POST', body: new FormData() })).status, 400);
    assert.equal((await fetch(`${url}/api/minus-one`, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: song() })).status, 403);
    const response = await fetch(`${url}/api/minus-one`, { method: 'POST', body: song() });
    assert.equal(response.status, 500);
    assert.ok(!(await response.json()).error.includes('Private'));
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).busy, false);
  });
  await withServer({ transcriber: worker(undefined, () => { throw new Error('Local vocal removal supports songs up to 15 minutes.'); }) }, async (url) => {
    const response = await fetch(`${url}/api/minus-one`, { method: 'POST', body: song() });
    assert.match((await response.json()).error, /15 minutes/);
  });
});

test('minus-one and transcription share one worker slot', async () => {
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const exited = new Promise((resolve) => { release = resolve; });
  await withServer({ transcriber: worker(undefined, async () => { started(); await exited; return { buffer: Buffer.from('ID3'), duration: 1 }; }) }, async (url) => {
    const first = fetch(`${url}/api/minus-one`, { method: 'POST', body: song() });
    await began;
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).busy, true);
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() })).status, 429);
    assert.equal((await fetch(`${url}/api/minus-one`, { method: 'POST', body: song() })).status, 429);
    release();
    assert.equal((await first).status, 200);
  });
});

const mp4 = (type = 'video/mp4') => {
  const form = new FormData();
  form.append('audio', new Blob(['video bytes'], { type }), 'song.mp4');
  return form;
};

test('MP3 API returns local conversion and minus-one accepts MP4 audio', async () => {
  let converted = false;
  let separated = false;
  const local = { ...worker(undefined, async ({ buffer }) => { separated = buffer.toString() === 'video bytes'; return { buffer: Buffer.from('ID3backing') }; }),
    convertMp3: async ({ buffer }) => { converted = buffer.toString() === 'video bytes'; return { buffer: Buffer.from('ID3converted') }; } };
  await withServer({ transcriber: local }, async (url) => {
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).mp3Available, true);
    const response = await fetch(`${url}/api/mp3`, { method: 'POST', body: mp4() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'ID3converted');
    assert.equal((await fetch(`${url}/api/minus-one`, { method: 'POST', body: mp4() })).status, 200);
    assert.ok(converted && separated);
  });
});

test('MP3 API fails closed, rejects invalid and foreign requests, and sanitizes failures', async () => {
  await withServer({ transcriber: { ...worker(), mp3Status: async () => ({ mp3Available: false }), convertMp3: () => assert.fail('Must not run') } }, async (url) => {
    const response = await fetch(`${url}/api/mp3`, { method: 'POST', body: mp4() });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /setup:local/);
  });
  await withServer({ transcriber: { ...worker(), convertMp3: () => { throw new Error('private path'); } } }, async (url) => {
    assert.equal((await fetch(`${url}/api/mp3`, { method: 'POST', body: mp4('text/plain') })).status, 400);
    assert.equal((await fetch(`${url}/api/mp3`, { method: 'POST', body: new FormData() })).status, 400);
    assert.equal((await fetch(`${url}/api/mp3`, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: mp4() })).status, 403);
    const response = await fetch(`${url}/api/mp3`, { method: 'POST', body: mp4() });
    assert.equal(response.status, 500);
    assert.doesNotMatch((await response.json()).error, /private/);
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).busy, false);
  });
});

test('cancelled MP3 conversion holds the shared slot until the worker exits', async () => {
  let started, release, workerSignal;
  const began = new Promise((resolve) => { started = resolve; });
  const exited = new Promise((resolve) => { release = resolve; });
  await withServer({ transcriber: { ...worker(), convertMp3: async ({ signal }) => { workerSignal = signal; started(); await exited; return { buffer: Buffer.from('ID3') }; } } }, async (url) => {
    const controller = new AbortController();
    const pending = fetch(`${url}/api/mp3`, { method: 'POST', body: mp4(), signal: controller.signal }).catch(() => {});
    await began; controller.abort(); await wait(50);
    assert.equal(workerSignal.aborted, true);
    assert.equal((await fetch(`${url}/api/minus-one`, { method: 'POST', body: mp4() })).status, 429);
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() })).status, 429);
    assert.equal((await fetch(`${url}/api/mp3`, { method: 'POST', body: mp4() })).status, 429);
    release(); await pending; await wait(20);
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).busy, false);
  });
});
