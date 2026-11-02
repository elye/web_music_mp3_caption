export interface LyricLine {
  start: number;
  end?: number;
  text: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  file: Blob;
  /** Backing track with the vocals removed, generated locally. */
  minusOne?: Blob;
  filename: string;
  lyrics: LyricLine[];
  lyricSource?: 'imported' | 'manual' | 'transcribed';
  offset: number;
}

export interface Preferences {
  volume: number;
  fontSize: number;
  gap: number;
  repeat: boolean;
  /** What repeat loops while it is on: the whole queue or just the current song. */
  repeatMode: 'queue' | 'song';
  fade: number;
  highContrast: boolean;
  /** Play the minus-one version of songs that have one. */
  minusOne: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  volume: 0.8,
  fontSize: 52,
  gap: 3,
  repeat: false,
  repeatMode: 'queue',
  fade: 1.2,
  highContrast: false,
  minusOne: false,
};
