import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Mic2, ShieldCheck, Sparkles } from 'lucide-react';
import type { LyricLine, Track } from '../types';
import { transcribeTrack } from '../lib/transcription';
import { Modal } from './Modal';

export function TranscriptionDialog({ tracks, available, onSave, onClose }: {
  tracks: Track[]; available: boolean | null; onSave: (id: string, lyrics: LyricLine[]) => void; onClose: () => void;
}) {
  const [running, setRunning] = useState(false);
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

  return <Modal title="Let the songs find their words" subtitle="Generate timed captions with OpenAI Whisper." onClose={() => { abort.current?.abort(); onClose(); }}>
    <div className="privacy-note"><ShieldCheck size={22} /><p><strong>Your choice, every time.</strong> Clicking Transcribe sends these songs to OpenAI for processing. Usage charges and OpenAI’s data policies apply. Your API key stays on the server. No audio is uploaded during normal playback.</p></div>
    {!available && <div className="setup-note"><strong>{available === null ? 'Transcription server unavailable' : 'One-time setup needed'}</strong><p>{available === null ? 'Start the app with pnpm dev to run both the web app and API.' : 'Add OPENAI_API_KEY to a .env file in the project, then restart the server. See the README for setup.'}</p><p>You can always import .lrc / .srt files or time your own lyrics for free.</p></div>}
    <label className="language-field">Song language<select value={language} disabled={running} onChange={(e) => setLanguage(e.target.value)}><option value="">Detect automatically</option><option value="en">English</option><option value="zh">Chinese</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="ko">Korean</option><option value="ja">Japanese</option><option value="id">Indonesian</option></select></label>
    <div className="transcription-tracks">{tracks.map((track) => <div className="transcription-track" key={track.id}>{completed.includes(track.id) ? <Check size={17} className="success" /> : <Mic2 size={17} />}<div><strong>{track.title}</strong>{track.lyrics.length > 0 && !completed.includes(track.id) && <small>Existing lyrics will be replaced after success.</small>}{failures[track.id] && <p className="inline-error">{failures[track.id]}</p>}</div></div>)}</div>
    <p className="field-hint">Singing and backing instruments can confuse speech recognition. Captions are line-timed, not word-by-word. Songs over 20 minutes need imported lyrics.</p>
    {message && <p className="transcription-status" role="status">{running && <LoaderCircle size={17} className="spin" />}{message}</p>}
    <footer className="modal-footer">{running ? <button className="button secondary" onClick={() => abort.current?.abort()}>Stop transcription</button> : <><button className="button ghost" onClick={onClose}>{completed.length ? 'Done' : 'Not now'}</button><button className="button primary" disabled={!available || !tracks.length || completed.length === tracks.length} onClick={() => void start()}><Sparkles size={17} />{completed.length ? 'Retry remaining' : `Transcribe ${tracks.length === 1 ? 'song' : `${tracks.length} songs`}`}</button></>}</footer>
  </Modal>;
}
