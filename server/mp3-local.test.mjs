import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLocalTranscriber } from './local-transcriber.mjs';

const python = resolve('.local-transcription/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const probe = spawnSync(python, ['-c', 'import av; av.codec.Codec("libmp3lame", "w")']);
const fixtureCode = `
import av, math, struct, sys
with av.open(sys.argv[1], 'w') as out:
    if sys.argv[2] == 'audio':
        stream = out.add_stream('aac', rate=44100)
        stream.layout = 'stereo'
        for i in range(44):
            frame = av.AudioFrame(format='s16', layout='stereo', samples=1024)
            frame.sample_rate = 44100
            samples = [int(12000 * math.sin(2 * math.pi * 440 * (i * 1024 + n) / 44100)) for n in range(1024)]
            pcm = b''.join(struct.pack('<hh', value, value) for value in samples)
            frame.planes[0].update(pcm + bytes(frame.planes[0].buffer_size - len(pcm)))
            for packet in stream.encode(frame): out.mux(packet)
        for packet in stream.encode(None): out.mux(packet)
    else:
        stream = out.add_stream('mpeg4', rate=25)
        stream.width, stream.height, stream.pix_fmt = 16, 16, 'yuv420p'
        frame = av.VideoFrame(16, 16, 'yuv420p')
        for plane in frame.planes: plane.update(bytes(plane.buffer_size))
        for packet in stream.encode(frame): out.mux(packet)
        for packet in stream.encode(None): out.mux(packet)
`;

test('real PyAV converts MP4 audio to a decodable MP3 and rejects video without audio', { skip: probe.status !== 0 }, async () => {
  await mkdir('.local-transcription', { recursive: true });
  const dir = await mkdtemp(resolve('.local-transcription/mp3-test-'));
  try {
    const mp4 = join(dir, 'audio.mp4');
    const video = join(dir, 'video.mp4');
    for (const [path, kind] of [[mp4, 'audio'], [video, 'video']]) {
      const result = spawnSync(python, ['-c', fixtureCode, path, kind], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const local = createLocalTranscriber();
    assert.equal((await local.mp3Status()).mp3Available, true);
    const result = await local.convertMp3({ buffer: await readFile(mp4) });
    const output = join(dir, 'result.mp3');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, result.buffer);
    const decoded = spawnSync(python, ['-c', 'import av,sys; c=av.open(sys.argv[1]); frames=list(c.decode(audio=0)); assert frames and sum(f.samples for f in frames)>40000; assert max(abs(f.to_ndarray()).max() for f in frames)>0.01; print(c.format.name)', output], { encoding: 'utf8' });
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.match(decoded.stdout, /mp3/);
    await assert.rejects(local.convertMp3({ buffer: await readFile(video) }), /could not find an audio track/);
    await assert.rejects(local.convertMp3({ buffer: Buffer.from('not an MP4') }), /could not read/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('MP3 worker cancellation waits for exit and cleans up its audio', async () => {
  await mkdir('.local-transcription', { recursive: true });
  const root = await mkdtemp(resolve('.local-transcription/mp3-test-'));
  try {
    let child, started;
    const began = new Promise((resolve) => { started = resolve; });
    const unavailable = createLocalTranscriber({ root });
    assert.equal((await unavailable.mp3Status()).mp3Available, false);
    const local = createLocalTranscriber({ root, spawnImpl: (_python, args, options) => {
      assert.ok(args[0].endsWith('mp3_local.py'));
      assert.equal(options.env.HF_HUB_OFFLINE, '1');
      child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
      child.once('spawn', started);
      return child;
    } });
    const controller = new AbortController();
    const pending = local.convertMp3({ buffer: Buffer.from('audio'), signal: controller.signal });
    await began; controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.deepEqual(await readdir(join(root, '.local-transcription', 'tmp')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
