import type { Track } from '../types';

export const softenedGain = (volume: number, softened: boolean) => Math.max(0, Math.min(1, volume)) * (softened ? 0.22 : 1);

/** One audio element and gain node for the whole session. Ramps never alter the queue. */
export class AudioEngine {
  readonly audio = new Audio();
  private context?: AudioContext;
  private gain?: GainNode;
  private objectUrl?: string;
  private pauseTimer?: ReturnType<typeof setTimeout>;
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

  private ramp(value: number, seconds: number) {
    if (!this.context || !this.gain) return;
    const param = this.gain.gain;
    const now = this.context.currentTime;
    // cancelAndHold prevents a jump when the leader reverses a fade mid-way.
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else {
      const current = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    }
    param.linearRampToValueAtTime(value, now + seconds);
  }

  load(track: Track) {
    this.sequence++;
    clearTimeout(this.pauseTimer);
    this.fading = false;
    this.audio.pause();
    this.ramp(0, 0);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(track.file);
    this.audio.src = this.objectUrl;
    this.audio.load();
    this.onChange();
  }

  async play() {
    const sequence = ++this.sequence;
    clearTimeout(this.pauseTimer);
    this.fading = false;
    await this.unlock();
    if (sequence !== this.sequence) return;
    await this.audio.play();
    if (sequence !== this.sequence) return;
    this.ramp(softenedGain(this.volume, this.softened), Math.min(this.fadeSeconds, 0.8));
    this.onChange();
  }

  pause() {
    this.sequence++;
    clearTimeout(this.pauseTimer);
    if (this.audio.paused) return;
    this.fading = true;
    this.ramp(0, this.fadeSeconds);
    this.onChange();
    this.pauseTimer = setTimeout(() => {
      this.audio.pause();
      this.fading = false;
      this.onChange();
    }, this.fadeSeconds * 1000);
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (!this.fading && !this.audio.paused) this.ramp(softenedGain(volume, this.softened), 0.15);
  }

  setSoftened(softened: boolean) {
    this.softened = softened;
    if (!this.fading && !this.audio.paused) this.ramp(softenedGain(this.volume, softened), 0.65);
  }

  seek(seconds: number) {
    if (!Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
    this.onChange();
  }

  clear() {
    this.sequence++;
    clearTimeout(this.pauseTimer);
    this.fading = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
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
