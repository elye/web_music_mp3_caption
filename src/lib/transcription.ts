import { normalizeLyrics } from './lyrics';
import type { LyricLine, Track } from '../types';

/** Encode a 16 kHz mono PCM WAV. A six-minute chunk is about 11 MB. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped * (clamped < 0 ? 32768 : 32767), true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function transcribeTrack(
  track: Track,
  signal: AbortSignal,
  onProgress: (message: string) => void,
  language = '',
): Promise<LyricLine[]> {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) {
    throw new Error('Local transcription must run from localhost on your computer. Start Chorus locally, then open http://127.0.0.1:3001.');
  }
  if (track.duration > 20 * 60) throw new Error('Automatic transcription currently supports songs up to 20 minutes. Import timed lyrics for longer audio.');
  onProgress('Preparing audio on this device…');
  const context = new AudioContext({ sampleRate: 16000 });
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await track.file.arrayBuffer());
  } finally { await context.close(); }
  signal.throwIfAborted();
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
  }
  const chunkSize = 6 * 60 * decoded.sampleRate;
  const total = Math.ceil(mono.length / chunkSize);
  const lyrics: LyricLine[] = [];
  for (let i = 0; i < total; i++) {
    signal.throwIfAborted();
    onProgress(`Transcribing locally · part ${i + 1} of ${total}…`);
    const start = i * chunkSize;
    const body = new FormData();
    body.append('audio', encodeWav(mono.subarray(start, start + chunkSize), decoded.sampleRate), 'song.wav');
    if (language) body.append('language', language);
    const response = await fetch('/api/transcribe', { method: 'POST', body, signal });
    const result = await response.json().catch(() => ({ error: 'The localhost helper returned an unexpected response.' }));
    if (!response.ok) throw new Error(result.error || 'Transcription failed.');
    if (!Array.isArray(result.lyrics)) throw new Error('The local worker returned no usable timestamps.');
    lyrics.push(...result.lyrics.map((line: LyricLine) => ({ ...line, start: line.start + start / decoded.sampleRate, end: line.end === undefined ? undefined : line.end + start / decoded.sampleRate })));
  }
  const normalized = normalizeLyrics(lyrics);
  if (!normalized.some((line) => line.text)) throw new Error('No lyrics were detected. Try importing an LRC file or adding lyrics manually.');
  return normalized;
}
