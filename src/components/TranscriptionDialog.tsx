import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Mic2, ShieldCheck, Sparkles } from 'lucide-react';
import type { LyricLine, Track } from '../types';
import { transcribeTrack } from '../lib/transcription';
import { Modal } from './Modal';

export function TranscriptionDialog({ tracks, onSave, onClose }: {
  tracks: Track[]; onSave: (id: string, lyrics: LyricLine[]) => void; onClose: () => void;
}) {
  const [status, setStatus] = useState<{ transcriptionAvailable: boolean; model?: string; message?: string; busy?: boolean } | null>(null);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const statusAbort = useRef<AbortController | null>(null);
  const refreshStatus = useCallback(async () => {
    statusAbort.current?.abort();
    const controller = new AbortController();
    statusAbort.current = controller;
    setChecking(true);
    try {
      const response = await fetch('/api/status', { signal: controller.signal });
      if (!response.ok) throw new Error('Local service unavailable');
      setStatus(await response.json());
    } catch { if (!controller.signal.aborted) setStatus(null); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }, []);
  useEffect(() => { void refreshStatus(); return () => statusAbort.current?.abort(); }, [refreshStatus]);
  const available = status?.transcriptionAvailable === true;
  const [message, setMessage] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setFailures({});
    try {
      for (const track of tracks.filter((item) => !completed.includes(item.id))) {
        if (controller.signal.aborted) break;
        setMessage(`Preparing “${track.title}”…`);
        try {
          const lyrics = await transcribeTrack(track, controller.signal, (status) => setMessage(`${track.title} · ${status}`), language);
          if (controller.signal.aborted) break;
          onSave(track.id, lyrics);
          setCompleted((current) => [...current, track.id]);
        } catch (error) {
          if (controller.signal.aborted) break;
          setFailures((current) => ({ ...current, [track.id]: error instanceof Error ? error.message : 'Transcription failed.' }));
        }
      }
    } finally {
      setRunning(false);
      setMessage(controller.signal.aborted ? 'Stopped. Completed songs have been saved.' : 'Finished. Review the words and timing before your session.');
    }
  }

  return <Modal title="Let the songs find their words" subtitle="Generate timed captions with Whisper, on this computer." onClose={() => { abort.current?.abort(); onClose(); }}>
    <div className="privacy-note"><ShieldCheck size={22} /><p><strong>On your computer. Not in the cloud.</strong> Audio goes only to the localhost helper on this device. The installed Whisper model does the processing here. No API key, usage fees, or internet connection is needed after setup. There is no cloud fallback.</p></div>
    {checking ? <p className="transcription-status" role="status"><LoaderCircle size={17} className="spin" /> Checking local model…</p> : !available ? <div className="setup-note"><strong>{status === null ? 'Local helper unavailable' : 'One-time local setup needed'}</strong><p>{status === null ? 'Run pnpm dev (or pnpm start after building) on this computer to start the localhost helper.' : 'Run pnpm setup:local to install the runtime and download the model once. After that, transcription works offline. For a disconnected machine, see the offline setup in the README.'}</p><button className="button secondary small" onClick={() => void refreshStatus()}>Check again</button><p>You can always import .lrc / .srt files or time your own lyrics without a model.</p></div> : <div className="local-model-status"><span><Check size={15} /> Whisper {status?.model || 'local'} · CPU · offline-ready</span>{status?.busy && <p>This computer is finishing another transcription. <button className="text-button" onClick={() => void refreshStatus()}>Check again</button></p>}</div>}
    <label className="language-field">Song language<select value={language} disabled={running} onChange={(e) => setLanguage(e.target.value)}><option value="">Detect automatically</option><option value="en">English</option><option value="zh">Chinese</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="ko">Korean</option><option value="ja">Japanese</option><option value="id">Indonesian</option></select></label>
    <div className="transcription-tracks">{tracks.map((track) => <div className="transcription-track" key={track.id}>{completed.includes(track.id) ? <Check size={17} className="success" /> : <Mic2 size={17} />}<div><strong>{track.title}</strong>{track.lyrics.length > 0 && !completed.includes(track.id) && <small>Existing lyrics will be replaced after success.</small>}{failures[track.id] && <p className="inline-error">{failures[track.id]}</p>}</div></div>)}</div>
    <p className="field-hint">Local processing can take a few minutes per song. Singing and instruments can confuse recognition—review the result. Captions are line-timed, not word-by-word. Songs over 20 minutes need imported lyrics.</p>
    {message && <p className="transcription-status" role="status">{running && <LoaderCircle size={17} className="spin" />}{message}</p>}
    <footer className="modal-footer">{running ? <button className="button secondary" onClick={() => abort.current?.abort()}>Stop transcription</button> : <><button className="button ghost" onClick={onClose}>{completed.length ? 'Done' : 'Not now'}</button><button className="button primary" disabled={checking || !available || status?.busy || !tracks.length || completed.length === tracks.length} onClick={() => void start()}><Sparkles size={17} />{completed.length ? 'Retry remaining' : `Transcribe ${tracks.length === 1 ? 'song' : `${tracks.length} songs`}`}</button></>}</footer>
  </Modal>;
}
