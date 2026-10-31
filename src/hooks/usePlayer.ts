import { useEffect, useReducer, useState } from 'react';
import { AudioEngine } from '../lib/audio';

export function usePlayer() {
  const [engine] = useState(() => new AudioEngine());
  const [, update] = useReducer((value) => value + 1, 0);
  useEffect(() => {
    engine.onChange = update;
    const events = ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'loadedmetadata', 'seeking', 'seeked', 'error', 'waiting', 'canplay'];
    events.forEach((event) => engine.audio.addEventListener(event, update));
    return () => {
      events.forEach((event) => engine.audio.removeEventListener(event, update));
      engine.onChange = () => {};
      engine.dispose();
    };
  }, [engine]);
  return {
    engine,
    time: engine.audio.currentTime || 0,
    duration: Number.isFinite(engine.audio.duration) ? engine.audio.duration : 0,
    playing: !engine.audio.paused && !engine.audio.ended,
    fading: engine.fading,
  };
}
