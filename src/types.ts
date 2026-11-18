export interface LyricLine {
  start: number;
  end?: number;
  text: string;
}

/** A musical key estimated from the audio. `tonic` is a pitch class: 0 = C … 11 = B. */
export interface TrackKey {
  tonic: number;
  mode: 'major' | 'minor';
  /** Correlation with the best-matching key profile, 0–1. Low values mean the estimate is a guess. */
  confidence: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  file: Blob;
  /** Optional MP4 associated with the song; its audio is used for generation. */
  video?: Blob;
  videoFilename?: string;
  videoDuration?: number;
  /** Per-song display and playback choices; absent values use legacy preferences. */
  showVideo?: boolean;
  showVideoCaptions?: boolean;
  videoDim?: number;
  videoBlur?: boolean;
  useMinusOne?: boolean;
  /** Backing track with the vocals removed, generated locally. */
  minusOne?: Blob;
  /** Whether this song participates in automatic queue playback; absent means included. */
  inQueue?: boolean;
  filename: string;
  lyrics: LyricLine[];
  lyricSource?: 'imported' | 'manual' | 'transcribed';
  offset: number;
  /** Live pitch shift for this song in semitones (negative = lower). Absent means 0. */
  pitch?: number;
  /** Key estimated from the original audio, filled in the first time the song is loaded. */
  key?: TrackKey;
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
  showVideo: boolean;
  showVideoCaptions: boolean;
  videoDim: number;
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
  showVideo: true,
  showVideoCaptions: true,
  videoDim: 0.5,
};
