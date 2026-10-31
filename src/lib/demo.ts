import { encodeWav } from './transcription';
import type { Track } from '../types';

/** Original, synthesized instrumental soundcheck. No remote or copyrighted audio. */
export function createDemoTrack(): Track {
  const rate = 16000;
  const duration = 32;
  const samples = new Float32Array(rate * duration);
  const melody = [60, 64, 67, 64, 65, 69, 67, 64, 62, 65, 69, 67, 64, 62, 60, 60];
  const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
  const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate;
    const beat = time % 2;
    const envelope = Math.min(1, beat / 0.03) * Math.exp(-beat * 1.7);
    const note = frequency(melody[Math.floor(time / 2) % melody.length]);
    const chord = chords[Math.floor(time / 8) % chords.length];
    const pad = chord.reduce((sum, midi) => sum + Math.sin(2 * Math.PI * frequency(midi) * time), 0) / 3;
    const edge = Math.min(1, time / 2, (duration - time) / 2);
    samples[i] = (0.25 * Math.sin(2 * Math.PI * note * time) * envelope + 0.07 * pad) * edge;
  }
  return {
    id: crypto.randomUUID(), title: 'A little room', artist: 'Instrumental soundcheck · original practice lyrics',
    duration, file: encodeWav(samples, rate), filename: 'Chorus - A little room.wav', offset: 0,
    lyricSource: 'manual',
    lyrics: [
      { start: 2, end: 8, text: 'Take a breath, let the day drift by' },
      { start: 8, end: 16, text: 'Make a little room for joy tonight' },
      { start: 16, end: 24, text: 'Every voice has a place in the song' },
      { start: 24, end: 31, text: 'Here together, we all belong' },
    ],
  };
}
