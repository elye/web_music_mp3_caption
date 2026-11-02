import { AudioLines, Download, FileText, Music2 } from 'lucide-react';
import type { Track } from '../types';
import { toLrc } from '../lib/lyrics';
import { downloadBlob, minusOneDownloadName, originalDownloadName, baseName } from '../lib/minusOne';
import { Modal } from './Modal';

export function DownloadDialog({ track, onMakeMinusOne, onClose }: {
  track: Track; onMakeMinusOne: () => void; onClose: () => void;
}) {
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
    <footer className="modal-footer"><button className="button ghost" onClick={onClose}>Close</button></footer>
  </Modal>;
}
