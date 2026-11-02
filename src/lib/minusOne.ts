import type { Track } from '../types';
import { readDuration } from './audio';

export const MAX_MINUS_ONE_SECONDS = 15 * 60;

/** Sends the song to the localhost helper, which removes the vocals and returns the backing track as an MP3. */
export async function generateMinusOne(track: Track, signal: AbortSignal): Promise<Blob> {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) {
    throw new Error('Minus-one generation must run from localhost on your computer. Start Chorus locally, then open http://127.0.0.1:3001.');
  }
  if (track.duration > MAX_MINUS_ONE_SECONDS) throw new Error('Minus-one generation supports songs up to 15 minutes.');
  const body = new FormData();
  body.append('audio', track.file, track.filename);
  const response = await fetch('/api/minus-one', { method: 'POST', body, signal });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: 'The localhost helper returned an unexpected response.' }));
    throw new Error(result.error || 'Minus-one generation failed.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('The local helper returned an empty backing track.');
  return new Blob([blob], { type: 'audio/mpeg' });
}

const unsafe = /[\\/:*?"<>|\u0000-\u001f]/g;
export const baseName = (filename: string) => filename.replace(/\.[^./\\]+$/, '').replace(unsafe, '_').trim() || 'song';

export function originalDownloadName(track: Track) {
  return track.filename.replace(unsafe, '_').trim() || `${baseName(track.title)}.mp3`;
}
/** Generated minus-ones are MP3s; uploaded ones keep the format they came in. */
export function minusOneDownloadName(track: Track) {
  const extension = track.minusOne instanceof File ? track.minusOne.name.match(/\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i)?.[1].toLowerCase() : undefined;
  return `${baseName(track.filename)} (minus-one).${extension ?? 'mp3'}`;
}

export const UPLOAD_ACCEPT = '.mp3,.wav,.m4a,.ogg,.flac,.aac,.webm,audio/*';
const SYNC_WARNING_SECONDS = 2;

/** Checks a user-supplied minus-one. It stays in the browser; nothing is sent to the helper. */
export async function checkUploadedMinusOne(track: Track, file: File): Promise<{ warning?: string }> {
  if (!/\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i.test(file.name)) throw new Error('Unsupported audio format. Use MP3, WAV, M4A, OGG, FLAC, AAC, or WebM.');
  if (file.size > 100 * 1024 * 1024) throw new Error('Larger than 100 MB.');
  let duration: number;
  try { duration = await readDuration(file); } catch { throw new Error('This audio file could not be read.'); }
  const difference = Math.abs(duration - track.duration);
  if (difference > SYNC_WARNING_SECONDS) {
    return { warning: `It is ${Math.round(difference)}s ${duration > track.duration ? 'longer' : 'shorter'} than the original, so it may not stay in sync with the lyrics.` };
  }
  return {};
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
