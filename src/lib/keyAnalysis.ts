import type { TrackKey } from '../types';
import { ANALYSIS_RATE } from './keyDetect';

/** Decodes the song at a low sample rate and estimates its key in a worker, so playback never stalls. */
export async function analyzeKey(file: Blob): Promise<TrackKey | undefined> {
  try {
    const decoded = await new OfflineAudioContext(1, 1, ANALYSIS_RATE).decodeAudioData(await file.arrayBuffer());
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] += data[i] / decoded.numberOfChannels;
    }
    const worker = new Worker(new URL('./keyWorker.ts', import.meta.url), { type: 'module' });
    return await new Promise<TrackKey | undefined>((resolve) => {
      worker.onmessage = (event: MessageEvent<{ key?: TrackKey }>) => { worker.terminate(); resolve(event.data.key); };
      worker.onerror = () => { worker.terminate(); resolve(undefined); };
      worker.postMessage({ samples, sampleRate: decoded.sampleRate }, [samples.buffer]);
    });
  } catch { return undefined; }
}
