import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.mjs';

async function withServer(options, run) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
const body = (type = 'audio/wav') => {
  const form = new FormData();
  form.append('audio', new Blob(['audio test fixture'], { type }), 'song.wav');
  return form;
};

test('status does not expose credentials and missing key disables transcription', async () => {
  await withServer({ apiKey: '' }, async (url) => {
    const result = await fetch(`${url}/api/status`).then((r) => r.json());
    assert.deepEqual(result, { transcriptionAvailable: false, provider: 'OpenAI Whisper' });
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() });
    assert.equal(response.status, 503);
  });
});

test('transcription sends audio to the fixed provider and returns clean timed lines', async () => {
  let requests = 0;
  await withServer({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.equal(options.body.get('model'), 'whisper-1');
    assert.equal(options.body.get('response_format'), 'verbose_json');
    return Response.json({ segments: [{ start: 1, end: 3, text: ' Hello ' }, { start: -2, end: 0, text: 'bad' }] });
  } }, async (url) => {
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).lyrics, [{ start: 1, end: 3, text: 'Hello' }]);
    assert.equal(requests, 1);
  });
});

test('blocks foreign browser origins before reaching the provider', async () => {
  await withServer({ apiKey: 'test-key', fetchImpl: () => { throw new Error('Must not run'); } }, async (url) => {
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: body() });
    assert.equal(response.status, 403);
  });
});

test('validates file types and sanitizes provider errors', async () => {
  await withServer({ apiKey: 'test-key', fetchImpl: async () => new Response('private provider error details', { status: 401 }) }, async (url) => {
    assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', body: body('text/plain') })).status, 400);
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', body: body() });
    assert.equal(response.status, 502);
    const message = (await response.json()).error;
    assert.match(message, /key is invalid/);
    assert.ok(!message.includes('private'));
  });
});

test('rejects a missing audio file and accepts the configured app origin', async () => {
  await withServer({ apiKey: 'test-key', origin: 'https://private.example' }, async (url) => {
    const response = await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { Origin: 'https://private.example' }, body: new FormData() });
    assert.equal(response.status, 400);
  });
});
