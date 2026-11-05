import type { TrackKey } from '../types';

/** Krumhansl–Kessler key profiles: how strongly each pitch class belongs to a major or minor key. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const ANALYSIS_RATE = 11025;
const FRAME = 8192;
const HOP = 4096;
const LOW_HZ = 65;
const HIGH_HZ = 2100;

/** In-place radix-2 FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** Sums the spectrum into the 12 pitch classes, frame by frame, giving each frame equal weight. */
export function chromagram(samples: Float32Array, sampleRate: number): Float64Array {
  const chroma = new Float64Array(12);
  const window = new Float64Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
  const binPitchClass: number[] = [];
  const binHz = sampleRate / FRAME;
  for (let bin = 0; bin < FRAME / 2; bin++) {
    const hz = bin * binHz;
    binPitchClass.push(hz < LOW_HZ || hz > HIGH_HZ ? -1 : ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12);
  }
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const frame = new Float64Array(12);
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) { const v = samples[start + i]; re[i] = v * window[i]; im[i] = 0; energy += v * v; }
    if (energy / FRAME < 1e-6) continue; // silence says nothing about the key
    fft(re, im);
    frame.fill(0);
    for (let bin = 0; bin < FRAME / 2; bin++) {
      const pitchClass = binPitchClass[bin];
      if (pitchClass >= 0) frame[pitchClass] += Math.sqrt(Math.hypot(re[bin], im[bin]));
    }
    const total = frame.reduce((sum, v) => sum + v, 0);
    if (total > 0) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / total;
  }
  return chroma;
}

function correlation(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) { meanA += a[i]; meanB += b[i]; }
  meanA /= n; meanB /= n;
  let cross = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cross += (a[i] - meanA) * (b[i] - meanB);
    varA += (a[i] - meanA) ** 2;
    varB += (b[i] - meanB) ** 2;
  }
  return varA && varB ? cross / Math.sqrt(varA * varB) : 0;
}

/** Picks the major or minor key whose profile best matches the pitch-class energy. */
export function keyFromChroma(chroma: ArrayLike<number>): TrackKey | undefined {
  if (!Array.from(chroma).some((v) => v > 0)) return undefined;
  let best: TrackKey | undefined;
  for (const mode of ['major', 'minor'] as const) {
    const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = profile.map((_, pc) => profile[(pc - tonic + 12) % 12]);
      const score = correlation(chroma, rotated);
      if (!best || score > best.confidence) best = { tonic, mode, confidence: score };
    }
  }
  return best && best.confidence > 0 ? { ...best, confidence: Math.min(1, best.confidence) } : undefined;
}

export function detectKey(samples: Float32Array, sampleRate: number = ANALYSIS_RATE): TrackKey | undefined {
  return keyFromChroma(chromagram(samples, sampleRate));
}
