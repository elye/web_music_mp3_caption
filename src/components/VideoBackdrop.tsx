import { useEffect, useRef } from 'react';
import './video-backdrop.css';

interface VideoBackdropProps {
  video: Blob;
  audio: HTMLAudioElement;
  visible: boolean;
  dim: number;
}

export function VideoBackdrop({ video, audio, visible, dim }: VideoBackdropProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    const element: HTMLVideoElement = node;

    const url = URL.createObjectURL(video);
    let disposed = false;
    let waiting = false;
    let playPending = false;
    let lastPlayAttempt = 0;

    element.muted = true;
    element.src = url;
    element.load();

    function sync(forceSeek = false, retryNow = false) {
      if (disposed || element.readyState < HTMLMediaElement.HAVE_METADATA) return;

      const time = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
      const duration = element.duration;
      const target = Number.isFinite(duration) ? Math.min(time, duration) : time;
      const atVideoEnd = Number.isFinite(duration) && time >= duration;
      const shouldPlay = !audio.paused && !audio.ended && !audio.seeking && !waiting && !atVideoEnd;

      if (forceSeek || Math.abs(element.currentTime - target) > (shouldPlay ? 0.2 : 0.01)) {
        try {
          element.currentTime = target;
        } catch {
          // A source may not yet be seekable; metadata or the next sync will retry.
        }
      }
      if (element.playbackRate !== audio.playbackRate) element.playbackRate = audio.playbackRate;

      if (!shouldPlay) {
        element.pause();
      } else if (element.paused && !playPending && (retryNow || Date.now() - lastPlayAttempt >= 1000)) {
        lastPlayAttempt = Date.now();
        playPending = true;
        void element.play().catch(() => {
          // Muted playback can still be blocked; retry on the next audio action or sync.
        }).finally(() => { playPending = false; });
      }
    }

    const onPlay = () => { waiting = false; sync(true, true); };
    const onPlaying = () => { waiting = false; sync(true, true); };
    const onWaiting = () => { waiting = true; sync(); };
    const onPause = () => { waiting = false; sync(true); };
    const onSeek = () => sync(true, true);
    const onTimeUpdate = () => sync();
    const onRateChange = () => sync();
    const onMetadata = () => sync(true, true);
    const onVideoReady = () => sync(false, true);

    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('seeking', onSeek);
    audio.addEventListener('seeked', onSeek);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ratechange', onRateChange);
    element.addEventListener('loadedmetadata', onMetadata);
    element.addEventListener('canplay', onVideoReady);
    const interval = window.setInterval(onTimeUpdate, 250);
    sync(true, true);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audio.removeEventListener('seeking', onSeek);
      audio.removeEventListener('seeked', onSeek);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ratechange', onRateChange);
      element.removeEventListener('loadedmetadata', onMetadata);
      element.removeEventListener('canplay', onVideoReady);
      element.pause();
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(url);
    };
  }, [video, audio]);

  const opacity = Number.isFinite(dim) ? Math.max(0, Math.min(1, dim)) : 0;
  return (
    <div className="video-backdrop" aria-hidden="true" style={{ visibility: visible ? 'visible' : 'hidden' }}>
      <video ref={videoRef} className="video-backdrop__video" muted playsInline preload="auto" />
      <div className="video-backdrop__dim" style={{ opacity }} />
    </div>
  );
}
