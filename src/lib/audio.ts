import type { Track } from '../types';

export const softenedGain = (volume: number, softened: boolean) => Math.max(0, Math.min(1, volume)) * (softened ? 0.22 : 1);

/** One audio element and gain node for the whole session. Ramps never alter the queue. */
export class AudioEngine {
  readonly audio = new Audio();
  private context?: AudioContext;
  private gain?: GainNode;
  private objectUrl?: string;
  /** The blob currently loaded into the audio element. */
  currentBlob?: Blob;
  /** Songs with a minus-one version play it instead of the original. */
  preferMinusOne = false;
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
  }

  private async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.context.createMediaElementSource(this.audio).connect(this.gain);
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  /** Ramps from the gain's current value, so a fade always starts where the sound actually is. */
  private ramp(value: number, seconds: number) {
    if (!this.context || !this.gain) return;
    const param = this.gain.gain;
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
      if (this.audio.seeking) { this.releaseSeekMute(); return; }
      this.seekMuted = false;
      if (this.live) this.ramp(softenedGain(this.volume, this.softened), 0.12);
    }, 80);
  };

  /** The version of a song that should be audible right now. */
  sourceFor(track: Track): Blob {
    return this.preferMinusOne && track.minusOne ? track.minusOne : track.file;
  }

  load(track: Track) {
    this.sequence++;
    this.cancelFade();
    this.cancelSeekMute();
    this.fading = false;
    this.audio.pause();
    this.ramp(0, 0);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.currentBlob = this.sourceFor(track);
    this.objectUrl = URL.createObjectURL(this.currentBlob);
    this.audio.src = this.objectUrl;
    this.audio.load();
    this.onChange();
  }

  /**
   * Switches to another version of the same song without losing the place. If it was playing,
   * the sound dips for a moment, then resumes at the same position.
   */
  async swap(blob: Blob) {
    if (blob === this.currentBlob) return;
    const sequence = ++this.sequence;
    this.cancelFade();
    this.cancelSeekMute();
    const wasPlaying = !this.audio.paused && !this.audio.ended;
    const position = this.audio.currentTime;
    this.fading = false;
    if (wasPlaying) {
      this.ramp(0, 0.06);
      await new Promise((resolve) => setTimeout(resolve, 70));
      if (sequence !== this.sequence) return;
    }
    this.audio.pause();
    const url = URL.createObjectURL(blob);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = url;
    this.currentBlob = blob;
    this.audio.src = url;
    this.audio.load();
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); this.audio.removeEventListener('loadedmetadata', done); this.audio.removeEventListener('error', done); resolve(); };
      const timer = setTimeout(done, 10000);
      this.audio.addEventListener('loadedmetadata', done);
      this.audio.addEventListener('error', done);
    });
    // Restore the position even if the user paused meanwhile; another load() owns the element otherwise.
    if (this.objectUrl !== url) return;
    if (position > 0 && Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.min(position, this.audio.duration);
    this.onChange();
    if (!wasPlaying || sequence !== this.sequence) return;
    await this.audio.play();
    if (sequence !== this.sequence) return;
    this.ramp(softenedGain(this.volume, this.softened), 0.12);
    this.onChange();
  }

  async play() {
    const sequence = ++this.sequence;
    this.cancelFade();
    this.cancelSeekMute();
    this.fading = false;
    await this.unlock();
    if (sequence !== this.sequence) return;
    await this.audio.play();
    if (sequence !== this.sequence) return;
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
    this.releaseSeekMute();
    this.onChange();
  }

  clear() {
    this.sequence++;
    this.cancelFade();
    this.cancelSeekMute();
    this.fading = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
    this.currentBlob = undefined;
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
