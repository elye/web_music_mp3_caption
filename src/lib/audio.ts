import type { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import type { Track } from '../types';
import { clampPitch } from './pitch';

export const softenedGain = (volume: number, softened: boolean) => Math.max(0, Math.min(1, volume)) * (softened ? 0.22 : 1);

/** One audio element and gain node for the whole session. Ramps never alter the queue. */
export class AudioEngine {
  /** The original song. It is the clock for everything: time, duration, ending, and seeking. */
  readonly audio = new Audio();
  /** The minus-one, kept playing silently in step with the original so switching is only a crossfade. */
  readonly backing = new Audio();
  private context?: AudioContext;
  private gain?: GainNode;
  private versionGains?: { original: GainNode; backing: GainNode };
  /** Both versions meet here, then go either straight on (dry) or through the pitch shifter (wet). */
  private paths?: { bus: GainNode; dry: GainNode; wet: GainNode };
  private shifter?: SoundTouchNode;
  private shifterLoading?: Promise<void>;
  private semitones = 0;
  /** False when this browser cannot run the pitch shifter. */
  pitchSupported = typeof AudioWorkletNode !== 'undefined';
  private objectUrl?: string;
  private backingBlob?: Blob;
  private backingUrl?: string;
  private backingReady = false;
  private wantsMinusOne = false;
  private syncTimer?: ReturnType<typeof setInterval>;
  private pauseTimer?: ReturnType<typeof setTimeout>;
  private seekTimer?: ReturnType<typeof setTimeout>;
  private seekMuted = false;
  private cancelPending?: () => void;
  private sequence = 0;
  private volume = 0.8;
  private softened = false;
  fadeSeconds = 1.2;
  fading = false;
  onChange = () => {};

  constructor() {
    this.audio.preload = 'metadata';
    this.backing.preload = 'auto';
    // Only switch to the minus-one once it can play, so the sound never drops into silence.
    this.backing.addEventListener('canplay', () => {
      if (!this.backingBlob || this.backingReady) return;
      this.backingReady = true;
      this.applyVersion();
      this.onChange();
    });
    this.backing.addEventListener('error', () => { this.backingReady = false; this.applyVersion(); });
    this.audio.addEventListener('ended', () => { this.backing.pause(); this.stopSync(); });
  }

  /** True when the minus-one is the version you can hear. */
  get playingMinusOne() {
    return this.wantsMinusOne && this.backingReady;
  }

  private async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      const original = this.context.createGain();
      const backing = this.context.createGain();
      this.versionGains = { original, backing };
      // The shifter is only loaded once a song is tuned, and is bypassed at 0 so untuned songs are untouched.
      const bus = this.context.createGain();
      const dry = this.context.createGain();
      const wet = this.context.createGain();
      wet.gain.value = 0;
      this.paths = { bus, dry, wet };
      // The output gain is created last: it carries volume, softening, and fades for both versions.
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      original.gain.value = this.playingMinusOne ? 0 : 1;
      backing.gain.value = this.playingMinusOne ? 1 : 0;
      this.context.createMediaElementSource(this.audio).connect(original);
      this.context.createMediaElementSource(this.backing).connect(backing);
      original.connect(bus);
      backing.connect(bus);
      bus.connect(dry);
      dry.connect(this.gain);
      wet.connect(this.gain);
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.semitones !== 0) await this.ensureShifter();
  }

  private ensureShifter(): Promise<void> {
    if (!this.context || !this.paths || !this.pitchSupported) return Promise.resolve();
    const { context, paths } = this;
    this.shifterLoading ??= (async () => {
      try {
        // Loaded on demand: the module needs AudioWorkletNode at import time, and most songs are never tuned.
        const { SoundTouchNode } = await import('@soundtouchjs/audio-worklet');
        await SoundTouchNode.register(context, processorUrl);
        const node = new SoundTouchNode({ context });
        node.pitchSemitones.value = this.semitones;
        paths.bus.connect(node);
        node.connect(paths.wet);
        this.shifter = node;
      } catch { this.pitchSupported = false; }
      this.applyPitch();
      this.onChange();
    })();
    return this.shifterLoading;
  }

  private applyPitch() {
    if (!this.paths) return;
    if (this.shifter) this.shifter.pitchSemitones.value = this.semitones;
    const shifted = Boolean(this.shifter) && this.semitones !== 0;
    this.ramp(shifted ? 0 : 1, 0.05, this.paths.dry);
    this.ramp(shifted ? 1 : 0, 0.05, this.paths.wet);
  }

  /** Shifts every version of the current song by whole semitones, live, without changing its speed. */
  setPitch(semitones: number) {
    const value = clampPitch(semitones);
    if (value === this.semitones) return;
    this.semitones = value;
    if (!this.context) return; // applied when the audio graph is first built
    if (value !== 0 && !this.shifter) void this.ensureShifter();
    else this.applyPitch();
  }

  /** Ramps from the gain's current value, so a fade always starts where the sound actually is. */
  private ramp(value: number, seconds: number, node = this.gain) {
    if (!this.context || !node) return;
    const param = node.gain;
    const now = this.context.currentTime;
    const current = param.value;
    param.cancelScheduledValues(now);
    // Without this anchor a ramp would start from the end of the previous one (possibly long ago),
    // so the fade would be skipped or cut short.
    param.setValueAtTime(current, now);
    if (seconds > 0) param.linearRampToValueAtTime(value, now + seconds);
    else param.setValueAtTime(value, now);
  }

  private cancelFade() {
    clearTimeout(this.pauseTimer);
    this.cancelPending?.();
    this.cancelPending = undefined;
  }

  private cancelSeekMute() {
    clearTimeout(this.seekTimer);
    this.seekMuted = false;
  }

  /** Whether the gain should currently follow the volume/soften settings. */
  private get live() {
    return !this.fading && !this.seekMuted && !this.audio.paused;
  }

  private releaseSeekMute = () => {
    clearTimeout(this.seekTimer);
    if (!this.seekMuted) return;
    // Wait for the new position's audio to be flowing before bringing the sound back.
    this.seekTimer = setTimeout(() => {
      if (this.audio.seeking || (this.playingMinusOne && this.backing.seeking)) { this.releaseSeekMute(); return; }
      this.seekMuted = false;
      if (this.live) this.ramp(softenedGain(this.volume, this.softened), 0.12);
    }, 80);
  };

  /** Crossfades to the version that should be audible. Both are already playing in step. */
  private applyVersion() {
    if (!this.versionGains) return;
    const minusOne = this.playingMinusOne;
    // A short crossfade hides the instant of the switch without a noticeable dip.
    this.ramp(minusOne ? 0 : 1, 0.05, this.versionGains.original);
    this.ramp(minusOne ? 1 : 0, 0.05, this.versionGains.backing);
  }

  /** Chooses the minus-one (true) or the original (false) for songs that have a minus-one. */
  setMinusOne(wanted: boolean) {
    this.wantsMinusOne = wanted;
    this.applyVersion();
    this.onChange();
  }

  /** Loads, replaces, or removes the minus-one of the current song. */
  syncMinusOne(blob: Blob | undefined) {
    if (blob === this.backingBlob) return;
    this.backing.pause();
    if (this.backingUrl) URL.revokeObjectURL(this.backingUrl);
    this.backingBlob = blob;
    this.backingReady = false;
    this.backingUrl = undefined;
    if (!blob) {
      this.backing.removeAttribute('src');
      this.backing.load();
    } else {
      this.backingUrl = URL.createObjectURL(blob);
      this.backing.src = this.backingUrl;
      this.backing.load();
      // Join the original wherever it is right now, including mid-song.
      const join = () => {
        this.backing.removeEventListener('loadedmetadata', join);
        if (this.backingBlob !== blob) return;
        this.alignBacking(true);
        if (this.isPlaying) void this.backing.play().catch(() => {});
      };
      this.backing.addEventListener('loadedmetadata', join);
    }
    this.applyVersion();
    this.onChange();
  }

  private get isPlaying() {
    return !this.audio.paused && !this.audio.ended;
  }

  private alignBacking(force = false) {
    if (!this.backingBlob || this.backing.readyState < 1) return;
    // An ended original restarts from the beginning when played again.
    const target = this.audio.ended ? 0 : this.audio.currentTime;
    if (force || Math.abs(target - this.backing.currentTime) > 0.05) this.backing.currentTime = target;
  }

  /**
   * Keeps the silent version locked to the original. Small drift is corrected by nudging its speed
   * (inaudible), and only a large one by seeking.
   */
  private startSync() {
    this.stopSync();
    this.syncTimer = setInterval(() => {
      if (!this.backingBlob || this.backing.readyState < 1) return;
      if (!this.isPlaying) { this.backing.pause(); return; }
      if (this.backing.paused) void this.backing.play().catch(() => {});
      const drift = this.audio.currentTime - this.backing.currentTime;
      if (Math.abs(drift) > 0.25) { this.backing.currentTime = this.audio.currentTime; this.backing.playbackRate = 1; }
      else if (Math.abs(drift) < 0.01) this.backing.playbackRate = 1;
      else this.backing.playbackRate = 1 + Math.max(-0.03, Math.min(0.03, drift * 0.5));
    }, 200);
  }

  private stopSync() {
    clearInterval(this.syncTimer);
    this.syncTimer = undefined;
    this.backing.playbackRate = 1;
  }

  load(track: Track) {
    this.sequence++;
    this.cancelFade();
    this.cancelSeekMute();
    this.fading = false;
    this.audio.pause();
    this.backing.pause();
    this.stopSync();
    this.ramp(0, 0);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(track.file);
    this.audio.src = this.objectUrl;
    this.audio.load();
    if (track.minusOne && track.minusOne === this.backingBlob) this.backing.currentTime = 0;
    this.syncMinusOne(track.minusOne);
    this.onChange();
  }

  async play() {
    const sequence = ++this.sequence;
    this.cancelFade();
    this.cancelSeekMute();
    this.fading = false;
    await this.unlock();
    if (sequence !== this.sequence) return;
    this.alignBacking(true);
    // Start the minus-one first; the original stays the last element to play.
    if (this.backingBlob) void this.backing.play().catch(() => {});
    await this.audio.play();
    if (sequence !== this.sequence) return;
    this.startSync();
    this.ramp(softenedGain(this.volume, this.softened), Math.min(this.fadeSeconds, 0.8));
    this.onChange();
  }

  /** Fades the sound to silence but leaves the audio running. Resolves false if something else interrupted the fade. */
  fadeOut(): Promise<boolean> {
    this.sequence++;
    this.cancelFade();
    this.cancelSeekMute();
    if (this.audio.paused) return Promise.resolve(true);
    this.fading = true;
    this.ramp(0, this.fadeSeconds);
    this.onChange();
    return new Promise((resolve) => {
      this.cancelPending = () => resolve(false);
      this.pauseTimer = setTimeout(() => {
        this.cancelPending = undefined;
        resolve(true);
      }, this.fadeSeconds * 1000);
    });
  }

  async pause() {
    if (this.audio.paused || !(await this.fadeOut())) return;
    this.audio.pause();
    this.backing.pause();
    this.stopSync();
    this.fading = false;
    this.onChange();
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.live) this.ramp(softenedGain(volume, this.softened), 0.15);
  }

  setSoftened(softened: boolean) {
    this.softened = softened;
    if (this.live) this.ramp(softenedGain(this.volume, softened), 0.8);
  }

  seek(seconds: number) {
    if (!Number.isFinite(this.audio.duration)) return;
    // Silence the old position immediately so its buffered audio doesn't overlap the new one.
    if (this.live) {
      this.seekMuted = true;
      this.ramp(0, 0.015);
    }
    this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
    if (this.backingBlob && this.backing.readyState >= 1) this.backing.currentTime = this.audio.currentTime;
    this.releaseSeekMute();
    this.onChange();
  }

  clear() {
    this.sequence++;
    this.cancelFade();
    this.cancelSeekMute();
    this.fading = false;
    this.audio.pause();
    this.stopSync();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
    this.syncMinusOne(undefined);
    this.onChange();
  }

  dispose() {
    this.clear();
    void this.context?.close();
  }
}

export function readDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const finish = (duration?: number) => {
      clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      if (duration && Number.isFinite(duration)) resolve(duration);
      else reject(new Error('This audio file could not be read. Try a standard MP3.'));
    };
    const timeout = setTimeout(() => finish(), 15000);
    audio.onloadedmetadata = () => { audio.onloadedmetadata = null; audio.onerror = null; finish(audio.duration); };
    audio.onerror = () => { audio.onerror = null; finish(); };
    audio.src = url;
  });
}
