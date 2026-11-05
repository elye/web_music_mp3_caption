import { describe, expect, it } from 'vitest';
import { ANALYSIS_RATE, detectKey, fft } from './keyDetect';

/** A synthetic "song": the scale degrees of a key, weighted by importance, each with two harmonics. */
function song(tonic: number, mode: 'major' | 'minor', seconds = 8, tuning = 440) {
  const scale = mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const weights: Record<number, number> = { 0: 3, 7: 2, [mode === 'major' ? 4 : 3]: 2 };
  const samples = new Float32Array(Math.floor(seconds * ANALYSIS_RATE));
  for (const degree of scale) {
    const midi = 48 + ((tonic + degree) % 12);
    const hz = tuning * 2 ** ((midi - 69) / 12);
    const weight = weights[degree] ?? 1;
    for (let i = 0; i < samples.length; i++) {
      const t = i / ANALYSIS_RATE;
      samples[i] += weight * 0.03 * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t) + 0.25 * Math.sin(6 * Math.PI * hz * t));
    }
  }
  return samples;
}

describe('fft', () => {
  it('finds the frequency of a sine wave', () => {
    const n = 1024;
    const re = new Float64Array(n).map((_, i) => Math.sin(2 * Math.PI * 64 * i / n));
    const im = new Float64Array(n);
    fft(re, im);
    const magnitudes = Array.from(re.slice(0, n / 2), (v, i) => Math.hypot(v, im[i]));
    expect(magnitudes.indexOf(Math.max(...magnitudes))).toBe(64);
  });
});

describe('detectKey', () => {
  it.each([
    [0, 'major'], [2, 'major'], [7, 'major'], [10, 'major'], [9, 'minor'], [4, 'minor'], [1, 'minor'],
  ] as const)('recognises tonic %i %s', (tonic, mode) => {
    const key = detectKey(song(tonic, mode));
    expect(key).toMatchObject({ tonic, mode });
    expect(key!.confidence).toBeGreaterThan(0.65);
  });

  it('tolerates a song tuned slightly off A440', () => {
    expect(detectKey(song(5, 'major', 8, 436))).toMatchObject({ tonic: 5, mode: 'major' });
  });

  it('returns nothing for silence', () => {
    expect(detectKey(new Float32Array(ANALYSIS_RATE * 4))).toBeUndefined();
  });
});
