declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }
  export interface StretchNode extends AudioWorkletNode {
    schedule(change: StretchSchedule): void;
    stop(when?: number): void;
  }
  interface SignalsmithStretchFactory {
    (context: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<StretchNode>;
    /** Same-origin URL of the worklet script; avoids the default blob: URL. */
    moduleUrl?: string;
  }
  const SignalsmithStretch: SignalsmithStretchFactory;
  export default SignalsmithStretch;
}
