import { describe, expect, it } from 'vitest';
import { clampPitch, formatKey, formatPitch, transposeKey } from './pitch';

describe('pitch helpers', () => {
  it('clamps and rounds to whole semitones in range', () => {
    expect(clampPitch(2.6)).toBe(3);
    expect(clampPitch(40)).toBe(6);
    expect(clampPitch(-40)).toBe(-6);
    expect(clampPitch(undefined)).toBe(0);
    expect(clampPitch(Number.NaN)).toBe(0);
  });

  it('transposes keys and wraps around the octave', () => {
    expect(transposeKey({ tonic: 7, mode: 'major', confidence: 0.9 }, 2)).toMatchObject({ tonic: 9 });
    expect(transposeKey({ tonic: 1, mode: 'minor', confidence: 0.9 }, -3)).toMatchObject({ tonic: 10 });
  });

  it('formats keys and shifts', () => {
    expect(formatKey({ tonic: 3, mode: 'major', confidence: 1 })).toBe('E♭ major');
    expect(formatKey({ tonic: 6, mode: 'minor', confidence: 1 })).toBe('F♯ minor');
    expect(formatPitch(0)).toBe('0');
    expect(formatPitch(2)).toBe('+2');
    expect(formatPitch(-1)).toBe('−1');
  });
});
