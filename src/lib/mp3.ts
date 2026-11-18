const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Explicitly converts an MP4's first audio track using the local helper; no cloud fallback. */
export async function generateMp3(file: Blob, filename: string, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) {
    throw new Error('MP3 conversion must run from localhost on your computer. Start Chorus locally, then open http://127.0.0.1:3001.');
  }
  if (!file.size) throw new Error('Choose a non-empty MP4 file.');
  if (file.size > MAX_FILE_SIZE) throw new Error('MP4 files must be under 100 MB.');
  if (!/^(video\/mp4|audio\/mp4)$/i.test(file.type) &&
      !((!file.type || file.type === 'application/octet-stream') && /\.mp4$/i.test(filename))) {
    throw new Error('Choose an MP4 file to convert to MP3.');
  }
  const body = new FormData();
  body.append('audio', file, filename);
  let response: Response;
  try {
    response = await fetch('/api/mp3', { method: 'POST', body, signal });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new Error('The localhost helper is unavailable. Start Chorus with pnpm dev or pnpm start, and run pnpm setup:local if needed.');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(typeof result.error === 'string' && result.error ? result.error : 'Local MP3 conversion failed. Check the local helper and run pnpm setup:local.');
  }
  if (!/^audio\/mpeg(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('The localhost helper did not return an MP3. Restart Chorus and run pnpm setup:local if needed.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('The local helper returned an empty MP3.');
  return new Blob([blob], { type: 'audio/mpeg' });
}
