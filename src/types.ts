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
  fade: number;
  highContrast: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  volume: 0.8,
  fontSize: 52,
  gap: 3,
  repeat: false,
  fade: 1.2,
  highContrast: false,
};
