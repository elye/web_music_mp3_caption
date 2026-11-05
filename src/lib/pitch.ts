import type { TrackKey } from '../types';

export const MIN_PITCH = -6;
export const MAX_PITCH = 6;

const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

/** Whole semitones only, within the range where the shifter still sounds natural. */
export function clampPitch(semitones: unknown): number {
  if (typeof semitones !== 'number' || !Number.isFinite(semitones)) return 0;
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.round(semitones)));
}

export function transposeKey(key: TrackKey, semitones: number): TrackKey {
  return { ...key, tonic: (((key.tonic + Math.round(semitones)) % 12) + 12) % 12 };
}

export function formatKey(key: TrackKey): string {
  return key.mode === 'major' ? `${MAJOR_NAMES[key.tonic]} major` : `${MINOR_NAMES[key.tonic]} minor`;
}

export function formatPitch(semitones: number): string {
  return semitones === 0 ? '0' : semitones > 0 ? `+${semitones}` : `−${Math.abs(semitones)}`;
}

/** Below this the best key profile fits poorly, so the readout is labelled as a guess. */
export const CONFIDENT_KEY = 0.65;
