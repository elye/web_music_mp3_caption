import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMp3 } from './mp3';

const file = new Blob(['video'], { type: 'video/mp4' });
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('generateMp3', () => {
  it('sends the MP4 only to the local helper and returns MP3 audio', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    const fetcher = vi.fn().mockResolvedValue(new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetcher);
    const abort = signal();
    const result = await generateMp3(file, 'song.mp4', abort);
    expect(result.type).toBe('audio/mpeg');
    expect(await result.text()).toBe('mp3');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/mp3');
    expect(options.signal).toBe(abort);
    expect(options.body.get('audio').name).toBe('song.mp4');
    expect(options.body.get('audio').type).toBe('video/mp4');
  });

  it('rejects remote use and non-MP4 inputs without uploading', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('window', { location: { hostname: 'example.com' } });
    await expect(generateMp3(file, 'song.mp4', signal())).rejects.toThrow(/localhost/);
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    await expect(generateMp3(new Blob(['audio'], { type: 'audio/mpeg' }), 'song.mp3', signal())).rejects.toThrow(/MP4/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports unavailable helpers, server errors and empty output', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Run pnpm setup:local.' }), { status: 503 }),
    ).mockResolvedValueOnce(new Response('', { headers: { 'Content-Type': 'audio/mpeg' } })).mockResolvedValueOnce(new Response('<html>')));
    await expect(generateMp3(file, 'song.mp4', signal())).rejects.toThrow(/pnpm dev/);
    await expect(generateMp3(file, 'song.mp4', signal())).rejects.toThrow(/setup:local/);
    await expect(generateMp3(file, 'song.mp4', signal())).rejects.toThrow(/empty MP3/);
    await expect(generateMp3(file, 'song.mp4', signal())).rejects.toThrow(/did not return an MP3/);
  });

  it('preserves cancellation and accepts an untyped MP4', async () => {
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
    const cancelled = new DOMException('cancelled', 'AbortError');
    const fetcher = vi.fn().mockRejectedValue(cancelled); vi.stubGlobal('fetch', fetcher);
    await expect(generateMp3(new Blob(['video']), 'song.MP4', signal())).rejects.toBe(cancelled);
    const controller = new AbortController(); controller.abort();
    await expect(generateMp3(file, 'song.mp4', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
