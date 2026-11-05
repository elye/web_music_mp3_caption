import { detectKey } from './keyDetect';

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  const { samples, sampleRate } = event.data;
  try { self.postMessage({ key: detectKey(samples, sampleRate) }); } catch { self.postMessage({ key: undefined }); }
};
