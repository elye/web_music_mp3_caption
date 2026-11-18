import { useEffect, useRef, useState } from 'react';
import { AudioLines, Download, FileText, Music2, Video } from 'lucide-react';
import { generateMp3 } from '../lib/mp3';
import type { Track } from '../types';
import { toLrc } from '../lib/lyrics';
import { downloadBlob, minusOneDownloadName, originalDownloadName, baseName } from '../lib/minusOne';
import { Modal } from './Modal';

export function DownloadDialog({ track, onMakeMinusOne, onClose }: {
  track: Track; onMakeMinusOne: () => void; onClose: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function downloadMp3() {
    if (!track.video || generating) return;
    const controller = new AbortController();
    abort.current = controller;
    setGenerating(true);
    setError('');
    try {
      const mp3 = await generateMp3(new Blob([track.video], { type: 'video/mp4' }), track.videoFilename ?? track.filename, controller.signal);
      if (!controller.signal.aborted) downloadBlob(mp3, `${baseName(track.videoFilename ?? track.filename)}.mp3`);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'MP3 generation failed.');
    } finally { if (!controller.signal.aborted) setGenerating(false); }
  }
  const hasLyrics = track.lyrics.some((line) => line.text);
  const originalName = originalDownloadName(track);
  const minusOneName = minusOneDownloadName(track);
  const lrcName = `${baseName(track.filename)}.lrc`;
  return <Modal title="Take it with you" subtitle={track.title} onClose={onClose}>
    <ul className="download-list">
      <li>
        <Music2 size={20} />
        <div><strong>Original</strong><small>{originalName}</small></div>
        <button className="button secondary small" onClick={() => downloadBlob(track.file, originalName)}><Download size={15} /> Download</button>
      </li>
      {track.video && <li>
        <Video size={20} />
        <div><strong>MP3 from video</strong><small>Extract audio locally from {track.videoFilename ?? 'MP4 video'}.</small></div>
        <button className="button secondary small" disabled={generating} onClick={() => void downloadMp3()}>{generating ? 'Generating…' : 'Generate MP3'}</button>
      </li>}
      {track.video && track.video !== track.file && <li>
        <Video size={20} />
        <div><strong>Attached video</strong><small>{track.videoFilename ?? 'video.mp4'}</small></div>
        <button className="button secondary small" onClick={() => downloadBlob(track.video!, track.videoFilename ?? 'video.mp4')}><Download size={15} /> Download</button>
      </li>}
      <li>
        <AudioLines size={20} />
        <div><strong>Minus-one</strong><small>{track.minusOne ? minusOneName : 'None yet. Make one, or upload your own.'}</small></div>
        {track.minusOne
          ? <button className="button secondary small" onClick={() => downloadBlob(track.minusOne!, minusOneName)}><Download size={15} /> Download</button>
          : <button className="button secondary small" onClick={onMakeMinusOne}>Make minus-one</button>}
      </li>
      <li>
        <FileText size={20} />
        <div><strong>Lyrics</strong><small>{hasLyrics ? lrcName : 'No lyrics yet.'}</small></div>
        <button className="button secondary small" disabled={!hasLyrics} onClick={() => downloadBlob(new Blob([toLrc(track.lyrics)], { type: 'text/plain' }), lrcName)}><Download size={15} /> Download</button>
      </li>
    </ul>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {generating && <p className="field-hint" role="status">Generating MP3 on this computer…</p>}
    <footer className="modal-footer"><button className="button ghost" onClick={onClose}>{generating ? 'Cancel' : 'Close'}</button></footer>
  </Modal>;
}
