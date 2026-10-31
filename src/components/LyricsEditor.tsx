import { useRef, useState } from 'react';
import { Download, FileUp, Play, Pause, Timer, Check } from 'lucide-react';
import type { Track } from '../types';
import { formatTime, parseLrc, parseSrt, toLrc } from '../lib/lyrics';
import { Modal } from './Modal';

export function LyricsEditor({ track, time, playing, onToggle, onSave, onClose }: {
  track: Track; time: number; playing: boolean; onToggle: () => void; onSave: (track: Track) => void; onClose: () => void;
}) {
  const [text, setText] = useState(toLrc(track.lyrics));
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lines = parseLrc(text);
  const unstamped = text.split('\n').filter((line) => line.trim() && !/^\s*\[/.test(line)).length;

  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('Lyrics files must be smaller than 2 MB.'); return; }
    const content = await file.text();
    if (/\.srt$/i.test(file.name)) {
      const parsed = parseSrt(content);
      if (!parsed.length) { setError('No valid subtitle timestamps found in this file.'); return; }
      setText(toLrc(parsed));
    } else setText(content);
    setImported(true);
    setError('');
  }

  function stampNextLine() {
    const rows = text.split('\n');
    const index = rows.findIndex((line) => line.trim() && !/^\s*\[/.test(line));
    if (index < 0) { setError('Paste plain lyrics first. Each line can then be stamped as you listen.'); return; }
    rows[index] = `${toLrc([{ start: time, text: rows[index].trim() }])}`;
    const updated = rows.join('\n');
    setText(updated);
    setError('');
    requestAnimationFrame(() => {
      if (textarea.current) textarea.current.scrollTop = Math.max(0, (index - 3) * 26);
    });
  }

  function save() {
    if (!title.trim()) { setError('Give this song a title.'); return; }
    if (unstamped) { setError(`${unstamped} line${unstamped === 1 ? '' : 's'} still need timestamps. Use “Stamp next line” as you listen.`); return; }
    if (text.trim() && !lines.length) { setError('Use timed lyrics such as [00:12.50]Your lyric here.'); return; }
    onSave({ ...track, title: title.trim(), artist: artist.trim(), lyrics: lines, lyricSource: imported ? 'imported' : 'manual' });
    onClose();
  }

  function download() {
    const url = URL.createObjectURL(new Blob([toLrc(lines)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${title || 'lyrics'}.lrc`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Modal title="Make the words your own" subtitle="Import timed lyrics, or paste the words and tap along to the music." onClose={onClose} wide>
    <div className="field-row">
      <label>Song title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></label>
      <label>Artist / note<input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={160} placeholder="Optional" /></label>
    </div>
    <div className="editor-toolbar">
      <button className="button secondary small" onClick={() => input.current?.click()}><FileUp size={16} /> Import .lrc / .srt / .txt</button>
      <button className="button ghost small" onClick={download} disabled={!lines.length}><Download size={16} /> Export LRC</button>
      <input ref={input} type="file" hidden accept=".lrc,.srt,.txt" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
    <label className="sr-only" htmlFor="lyrics-input">Timed lyrics</label>
    <textarea ref={textarea} id="lyrics-input" className="lyrics-editor" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setError(''); }} placeholder={'[00:08.00]The first line of your song\n[00:14.50]And the next line goes here\n\nOr paste plain lyrics, play the song,\nand stamp each line when it begins.'} />
    <div className="timing-toolbar">
      <button className="icon-button" aria-label={playing ? 'Pause while editing' : 'Play while editing'} onClick={onToggle}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <span className="mono">{formatTime(time)}</span>
      <button className="button secondary small" onClick={stampNextLine} disabled={!unstamped}><Timer size={16} /> Stamp next line</button>
      <span className="muted">{unstamped ? `${unstamped} to time` : `${lines.length} timed lines`}</span>
    </div>
    <p className="field-hint">Timestamps use minutes:seconds. Add a blank timed line for an instrumental break. Review automatic lyrics before singing together.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <footer className="modal-footer"><button className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" onClick={save}><Check size={17} /> Save lyrics</button></footer>
  </Modal>;
}
