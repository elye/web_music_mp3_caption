import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalTranscriber, offlineEnvironment } from './local-transcriber.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'chorus-worker-test-'));
  const local = join(root, '.local-transcription');
  const python = join(local, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const model = join(local, 'models', 'base');
  try {
    await mkdir(join(python, '..'), { recursive: true });
    await mkdir(model, { recursive: true });
    await writeFile(python, 'fixture', { mode: 0o700 });
    for (const file of ['model.bin', 'config.json', 'tokenizer.json']) await writeFile(join(model, file), 'fixture');
    await run(root, local);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('worker environment explicitly disables downloads and telemetry', () => {
  const env = offlineEnvironment('/tmp/fixture');
  for (const key of ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY', 'DO_NOT_TRACK']) assert.equal(env[key], '1');
});

test('status fails closed for an absent model or tokenizer', async () => {
  await fixture(async (root, local) => {
    const transcriber = createLocalTranscriber({ root });
    assert.equal((await transcriber.status()).transcriptionAvailable, true);
    await rm(join(local, 'models/base/tokenizer.json'));
    assert.equal((await transcriber.status()).transcriptionAvailable, false);
    await assert.rejects(transcriber.transcribe({ buffer: Buffer.from('audio') }), /not set up/);
  });
});

test('local worker receives only filesystem paths, returns Unicode, and removes its temporary audio', async () => {
  await fixture(async (root, local) => {
    const transcriber = createLocalTranscriber({ root, spawnImpl: (_python, args, options) => {
      assert.ok(args.includes(join(local, 'models/base')));
      assert.ok(args.includes('--audio'));
      assert.ok(!args.some((arg) => arg.includes('https:')));
      assert.equal(options.env.HF_HUB_OFFLINE, '1');
      return spawn(process.execPath, ['-e', 'console.log(JSON.stringify({ lyrics: [{start:0,end:1,text:"一起唱歌"}], local:true }))'], options);
    } });
    assert.equal((await transcriber.transcribe({ buffer: Buffer.from('audio') })).lyrics[0].text, '一起唱歌');
    assert.deepEqual(await readdir(join(local, 'tmp')), []);
  });
});

test('cancellation kills the worker before resolving and removes temporary audio', async () => {
  await fixture(async (root, local) => {
    let child;
    let started;
    const began = new Promise((resolve) => { started = resolve; });
    const transcriber = createLocalTranscriber({ root, spawnImpl: (_python, _args, options) => {
      child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
      child.once('spawn', started);
      return child;
    } });
    const controller = new AbortController();
    const pending = transcriber.transcribe({ buffer: Buffer.from('audio'), signal: controller.signal });
    await began;
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.deepEqual(await readdir(join(local, 'tmp')), []);
  });
});

test('timeouts and bad worker output clean up without a cloud retry', async () => {
  await fixture(async (root, local) => {
    const timed = createLocalTranscriber({ root, timeoutMs: 100, spawnImpl: (_python, _args, options) => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options) });
    await assert.rejects(timed.transcribe({ buffer: Buffer.from('audio') }), /took too long/);
    assert.deepEqual(await readdir(join(local, 'tmp')), []);
    const invalid = createLocalTranscriber({ root, spawnImpl: (_python, _args, options) => spawn(process.execPath, ['-e', 'console.log("not json")'], options) });
    await assert.rejects(invalid.transcribe({ buffer: Buffer.from('audio') }), /invalid result/);
    assert.deepEqual(await readdir(join(local, 'tmp')), []);
  });
});
