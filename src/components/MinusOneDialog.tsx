import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, LoaderCircle, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import type { Track } from '../types';
import { checkUploadedMinusOne, generateMinusOne, MAX_MINUS_ONE_SECONDS, UPLOAD_ACCEPT } from '../lib/minusOne';
import { formatTime } from '../lib/lyrics';
import { Modal } from './Modal';

export function MinusOneDialog({ tracks, onSave, onClose }: {
  tracks: Track[]; onSave: (id: string, minusOne: Blob) => void; onClose: () => void;
}) {
  const [status, setStatus] = useState<{ minusOneAvailable?: boolean; minusOneMessage?: string; busy?: boolean } | null>(null);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<Track | null>(null);
  const statusAbort = useRef<AbortController | null>(null);
  const abort = useRef<AbortController | null>(null);

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
  useEffect(() => () => abort.current?.abort(), []);
  // Separation reports no partial progress, so show that it is alive.
  useEffect(() => {
    if (!currentId) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => clearInterval(timer);
  }, [currentId]);

  const available = status?.minusOneAvailable === true;

  async function upload(track: Track, file: File) {
    setFailures((current) => { const { [track.id]: _removed, ...rest } = current; return rest; });
    try {
      const { warning } = await checkUploadedMinusOne(track, file);
      onSave(track.id, file);
      setCompleted((current) => current.includes(track.id) ? current : [...current, track.id]);
      setWarnings((current) => warning ? { ...current, [track.id]: warning } : (({ [track.id]: _removed, ...rest }) => rest)(current));
      setMessage('Saved your minus-one. Use the Original / Minus-one switch in the player to compare.');
    } catch (error) {
      setFailures((current) => ({ ...current, [track.id]: `${file.name}: ${error instanceof Error ? error.message : 'could not be used.'}` }));
    }
  }

  async function start() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setFailures({});
    try {
      for (const track of tracks.filter((item) => !completed.includes(item.id))) {
        if (controller.signal.aborted) break;
        setCurrentId(track.id);
        setMessage(`Removing the vocals from “${track.title}”…`);
        try {
          const minusOne = await generateMinusOne(track, controller.signal);
          if (controller.signal.aborted) break;
          onSave(track.id, minusOne);
          setCompleted((current) => [...current, track.id]);
        } catch (error) {
          if (controller.signal.aborted) break;
          setFailures((current) => ({ ...current, [track.id]: error instanceof Error ? error.message : 'Minus-one generation failed.' }));
        }
      }
    } finally {
      setCurrentId(null);
      setRunning(false);
      setMessage(controller.signal.aborted ? 'Stopped. Completed songs have been saved.' : 'Finished. Use the Original / Minus-one switch in the player to compare.');
    }
  }

  return <Modal title="Make a minus-one" subtitle="Remove the singer and keep the band, on this computer." onClose={() => { abort.current?.abort(); onClose(); }}>
    <div className="privacy-note"><ShieldCheck size={22} /><p><strong>On your computer. Not in the cloud.</strong> The song goes only to the localhost helper. The Demucs model separates the vocals here. Your original is kept; the minus-one is saved beside it, and you can switch between them while playing. No API key or internet connection is needed after setup. Uploaded files never leave the browser.</p></div>
    {checking ? <p className="transcription-status" role="status"><LoaderCircle size={17} className="spin" /> Checking the local vocal remover…</p>
      : !available ? <div className="setup-note"><strong>{status === null ? 'Local helper unavailable' : 'One-time local setup needed'}</strong><p>{status === null ? 'Run pnpm dev (or pnpm start after building) on this computer to start the localhost helper.' : 'Run pnpm setup:local to install the vocal remover once (a large download, mostly PyTorch). After that, it works offline.'}</p><button className="button secondary small" onClick={() => void refreshStatus()}>Check again</button></div>
      : <div className="local-model-status"><span><Check size={15} /> Demucs htdemucs · CPU · offline-ready</span>{status?.busy && <p>This computer is finishing another job. <button className="text-button" onClick={() => void refreshStatus()}>Check again</button></p>}</div>}
    <div className="transcription-tracks">{tracks.map((track) => <div className="transcription-track" key={track.id}>{completed.includes(track.id) ? <Check size={17} className="success" /> : currentId === track.id ? <LoaderCircle size={17} className="spin" /> : <AudioLines size={17} />}<div><strong>{track.title}</strong>
      {currentId === track.id && <small>Working · {formatTime(elapsed)}</small>}
      {track.minusOne && !completed.includes(track.id) && currentId !== track.id && <small>The existing minus-one will be replaced after success.</small>}
      {track.duration > MAX_MINUS_ONE_SECONDS && <p className="inline-error">Longer than 15 minutes; this song will be skipped with an error.</p>}
      {failures[track.id] && <p className="inline-error">{failures[track.id]}</p>}
      {warnings[track.id] && <p className="field-hint">{warnings[track.id]}</p>}
      {!running && tracks.length > 1 && <button className="text-button" onClick={() => { uploadTarget.current = track; uploadInput.current?.click(); }}><Upload size={14} />{track.minusOne || completed.includes(track.id) ? 'Upload a different one' : 'Upload your own'}</button>}</div></div>)}</div>
    <input ref={uploadInput} type="file" accept={UPLOAD_ACCEPT} hidden onChange={(event) => {
      const file = event.target.files?.[0];
      const track = uploadTarget.current;
      event.target.value = '';
      if (file && track) void upload(track, file);
    }} />
    <p className="field-hint">Already have a minus-one, such as a karaoke version? Use “Upload your own”. It stays in this browser and is not processed. It should match the original’s timing.</p>
    <p className="field-hint">Generating takes roughly a fraction of the song’s length up to about its full length, depending on your CPU. Quiet traces of the singer, or of backing vocals, can remain; sounds that sit in the middle of the mix may thin out. Songs over 15 minutes are not supported.</p>
    {message && <p className="transcription-status" role="status">{running && <LoaderCircle size={17} className="spin" />}{message}</p>}
    <footer className="modal-footer">{running ? <button className="button secondary" onClick={() => abort.current?.abort()}>Stop</button> : <><button className="button ghost" onClick={onClose}>{completed.length ? 'Done' : 'Not now'}</button>{tracks.length === 1 && <button className="button neutral" onClick={() => { uploadTarget.current = tracks[0]; uploadInput.current?.click(); }}><Upload size={17} />{tracks[0].minusOne || completed.includes(tracks[0].id) ? 'Upload a different one' : 'Upload your own'}</button>}<button className="button primary" disabled={checking || !available || status?.busy || !tracks.length || completed.length === tracks.length} onClick={() => void start()}><Sparkles size={17} />{completed.length ? 'Retry remaining' : `Generate for ${tracks.length === 1 ? 'this song' : `${tracks.length} songs`}`}</button></>}</footer>
  </Modal>;
}
