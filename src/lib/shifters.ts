import soundTouchProcessorUrl from '@soundtouchjs/audio-worklet/processor?url';
// The package only exports its entry points, so the worklet script is reached by path. Vite serves it
// from this origin, which is why the page's script policy never needs to allow blob: scripts.
import stretchProcessorUrl from '../../node_modules/signalsmith-stretch/SignalsmithStretch.js?url';

/** A pitch shifter that sits in the audio graph. Connect into `input`, take sound from `output`. */
export interface PitchShifter {
  input: AudioNode;
  output: AudioNode;
  setSemitones(semitones: number): void;
  readonly kind: 'natural' | 'basic';
}

/** Rough fundamental used for formant analysis; a mid value suits a mixed group of singers. */
const FORMANT_BASE_HZ = 200;
const STRETCH_LOAD_TIMEOUT_MS = 5000;

/**
 * Shifts pitch while keeping the formants (the resonances that make a voice sound like itself) in place,
 * so raised voices don't turn into chipmunks and lowered ones don't turn muddy.
 */
async function createNaturalShifter(context: AudioContext): Promise<PitchShifter> {
  const { default: SignalsmithStretch } = await import('signalsmith-stretch');
  SignalsmithStretch.moduleUrl = stretchProcessorUrl;
  // A blocked or broken WASM module would otherwise leave this waiting forever.
  const node = await Promise.race([
    SignalsmithStretch(context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      // Always process stereo, even for mono songs.
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Pitch shifter did not start.')), STRETCH_LOAD_TIMEOUT_MS)),
  ]);
  let semitones = 0;
  const apply = () => node.schedule({ active: true, rate: 1, semitones, formantCompensation: true, formantBaseHz: FORMANT_BASE_HZ });
  apply();
  return {
    input: node,
    output: node,
    kind: 'natural',
    setSemitones(value) { semitones = value; apply(); },
  };
}

/** Lighter resampling-based shifter. Pitch is right, but voices sound thinner or heavier. */
async function createBasicShifter(context: AudioContext): Promise<PitchShifter> {
  // Loaded on demand: the module needs AudioWorkletNode at import time.
  const { SoundTouchNode } = await import('@soundtouchjs/audio-worklet');
  await SoundTouchNode.register(context, soundTouchProcessorUrl);
  const node = new SoundTouchNode({ context });
  return {
    input: node,
    output: node,
    kind: 'basic',
    setSemitones(value) { node.pitchSemitones.value = value; },
  };
}

/** Prefers the voice-preserving shifter and quietly falls back to the basic one. */
export async function createPitchShifter(context: AudioContext): Promise<PitchShifter> {
  try { return await createNaturalShifter(context); } catch { return createBasicShifter(context); }
}
