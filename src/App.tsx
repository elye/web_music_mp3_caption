import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown, ArrowUp, AudioLines, Check, ChevronDown, CloudOff, Disc3, Download, FileText, Headphones, ListMusic,
  LoaderCircle, Maximize, Minimize, Music2, Pause, Play, Plus, Repeat2, RotateCcw,
  Settings2, ShieldCheck, SkipBack, SkipForward, Sparkles, Trash2, Upload, Volume1, Volume2, VolumeX, Waves, X,
} from 'lucide-react';
import type { LyricLine, Preferences, Track } from './types';
import { formatTime, lyricTransitionMs, lyricWindow, nextLyricIndex, titleFromFilename } from './lib/lyrics';
import { readDuration } from './lib/audio';
import { loadTracks, readPreferences, removeStoredTrack, storeOrder, storePreferences, storeTrack } from './lib/storage';
import { createDemoTrack } from './lib/demo';
import { usePlayer } from './hooks/usePlayer';
import { LyricsEditor } from './components/LyricsEditor';
import { LyricStack } from './components/LyricStack';
import { FadeThrough } from './components/FadeThrough';
import { Modal } from './components/Modal';
import { Settings } from './components/Settings';
import { TranscriptionDialog } from './components/TranscriptionDialog';
import { MinusOneDialog } from './components/MinusOneDialog';
import { DownloadDialog } from './components/DownloadDialog';

function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [softened, setSoftened] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [stageOnly, setStageOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [transcribeIds, setTranscribeIds] = useState<string[] | null>(null);
  const [minusOneIds, setMinusOneIds] = useState<string[] | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind?: 'error' | 'success' } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [gap, setGap] = useState<{ nextId: string; remaining: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const transitionTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const importLock = useRef(false);
  const orderLock = useRef(false);
  const { engine, time, duration, playing, fading } = usePlayer();
  const active = tracks.find((track) => track.id === activeId);
  const activeIndex = tracks.findIndex((track) => track.id === activeId);
  const actualDuration = duration || active?.duration || 0;
  const totalDuration = tracks.reduce((total, track) => total + track.duration, 0);
  const readyLyrics = tracks.filter((track) => track.lyrics.some((line) => line.text)).length;
  const nextIndex = active ? nextLyricIndex(active.lyrics, time, active.offset) : -1;
  const nextLine = active?.lyrics[nextIndex];
  // The upcoming line starts rising a moment early while playing, so the gap message fades as it grows in.
  const lyricLead = playing ? 1.5 : 0;
  const lyricWin = active ? lyricWindow(active.lyrics, time, active.offset, lyricLead) : null;
  const lyricMs = active && lyricWin ? lyricTransitionMs(active.lyrics, lyricWin, time, active.offset, lyricLead) : 700;
  const hasLyrics = Boolean(active?.lyrics.some((line) => line.text));
  // The version actually audible: the minus-one only exists for songs it has been generated for.
  const usingMinusOne = Boolean(active?.minusOne && preferences.minusOne);
  const repeatSong = preferences.repeat && preferences.repeatMode === 'song';
  const repeatQueue = preferences.repeat && preferences.repeatMode === 'queue';
  const isPresenting = fullscreen || stageOnly;
  // What the stage is showing; when this changes the content fades out and the new content fades in.
  const stageView = !active ? 'welcome' : gap ? 'gap' : finished ? 'finished' : !hasLyrics ? `bare:${active.id}` : `lyrics:${active.id}`;
  const modalOpen = settingsOpen || editing || Boolean(transcribeIds) || Boolean(minusOneIds) || downloadOpen || Boolean(removeId);

  const notify = useCallback((text: string, kind?: 'error' | 'success') => setNotice({ text, kind }), []);
  const storageError = useCallback(() => notify('Your browser could not save this change. It still works for this session; export important lyrics before closing.', 'error'), [notify]);
  const cancelGap = useCallback(() => {
    clearInterval(transitionTimer.current);
    transitionTimer.current = undefined;
    setGap(null);
  }, []);

  const chooseVersion = useCallback((minusOne: boolean) => {
    if (!active) return;
    if (minusOne && !active.minusOne) { setMinusOneIds([active.id]); return; }
    setPreferences((value) => ({ ...value, minusOne }));
  }, [active]);

  const play = useCallback(() => {
    void engine.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      notify('Playback could not start. Try pressing Play again, or check this audio file.', 'error');
    });
  }, [engine, notify]);

  const selectTrack = useCallback((track: Track, autoplay = false) => {
    cancelGap();
    setFinished(false);
    setActiveId(track.id);
    engine.load(track);
    if (autoplay) play();
  }, [cancelGap, engine, play]);

  useEffect(() => {
    let live = true;
    void loadTracks().then((saved) => {
      if (!live) return;
      setTracks(saved);
      if (saved[0]) selectTrack(saved[0]);
    }).catch(() => { if (live) storageError(); }).finally(() => { if (live) setReady(true); });
    return () => { live = false; clearInterval(transitionTimer.current); };
  }, [selectTrack, storageError]);

  useEffect(() => {
    engine.fadeSeconds = preferences.fade;
    engine.setVolume(preferences.volume);
    engine.setMinusOne(preferences.minusOne);
    try { storePreferences(preferences); } catch { /* Audio remains usable when browser storage is blocked. */ }
  }, [engine, preferences]);
  useEffect(() => { engine.setSoftened(softened); }, [engine, softened]);
  // A minus-one generated or uploaded for the song that is already loaded joins playback in step.
  const activeMinusOne = active?.minusOne;
  useEffect(() => { engine.syncMinusOne(activeMinusOne); }, [engine, activeMinusOne]);
  useEffect(() => { if (ready) void storeOrder(tracks.map((track) => track.id)).catch(storageError); }, [tracks, ready, storageError]);
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const onError = () => { if (engine.audio.error) notify('This audio could not be played. The song is still in your queue. Try another MP3.', 'error'); };
    const onBackingError = () => { if (engine.backing.error) notify('The minus-one could not be played, so the original is playing. Try uploading or generating it again.', 'error'); };
    engine.audio.addEventListener('error', onError);
    engine.backing.addEventListener('error', onBackingError);
    return () => { engine.audio.removeEventListener('error', onError); engine.backing.removeEventListener('error', onBackingError); };
  }, [engine, notify]);

  useEffect(() => {
    const ended = () => {
      // A pause started near the end must not unexpectedly start another song.
      if (engine.fading) { cancelGap(); return; }
      // Repeating the current song: start it again straight away, with no gap.
      if (repeatSong) { play(); return; }
      const next = tracks[activeIndex + 1] ?? (repeatQueue ? tracks[0] : undefined);
      if (!next) { setFinished(true); return; }
      if (preferences.gap === 0) { selectTrack(next, true); return; }
      const deadline = Date.now() + preferences.gap * 1000;
      setGap({ nextId: next.id, remaining: preferences.gap });
      clearInterval(transitionTimer.current);
      transitionTimer.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        if (!remaining) selectTrack(next, true);
        else setGap({ nextId: next.id, remaining });
      }, 200);
    };
    engine.audio.addEventListener('ended', ended);
    return () => engine.audio.removeEventListener('ended', ended);
  }, [activeIndex, cancelGap, engine, play, preferences.gap, repeatQueue, repeatSong, selectTrack, tracks]);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  // Keep the projected lyrics awake where the browser supports Screen Wake Lock.
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    let disposed = false;
    const acquire = async () => {
      if (!isPresenting || !playing || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      try {
        const result = await navigator.wakeLock.request('screen');
        if (disposed) await result.release(); else lock = result;
      } catch { /* Optional capability; playback does not depend on it. */ }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => { disposed = true; document.removeEventListener('visibilitychange', acquire); void lock?.release(); };
  }, [isPresenting, playing]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stageOnly) setStageOnly(false);
      else if (appRef.current?.requestFullscreen) await appRef.current.requestFullscreen();
      else setStageOnly(true);
    } catch {
      setStageOnly((value) => !value);
      notify('Using a focused stage view. This browser did not allow fullscreen.');
    }
  }, [notify, stageOnly]);

  const togglePlayback = useCallback(() => {
    if (gap) { cancelGap(); notify('Auto-advance paused. Press Play to continue.'); return; }
    if (!active) return;
    if (playing && !fading) void engine.pause();
    else {
      if (engine.audio.ended) {
        const next = tracks[activeIndex + 1] ?? (repeatQueue || finished ? tracks[0] : undefined);
        if (next) { selectTrack(next, true); return; }
        engine.seek(0);
      }
      setFinished(false);
      play();
    }
  }, [active, activeIndex, cancelGap, engine, fading, finished, gap, notify, play, playing, repeatQueue, selectTrack, tracks]);

  // While music is audible, fade it out before changing song or position instead of cutting it off.
  const afterFadeOut = useCallback((action: () => void) => {
    if (!playing || fading) { action(); return; }
    void engine.fadeOut().then((completed) => { if (completed) action(); });
  }, [engine, fading, playing]);

  function nextTrack() {
    const next = tracks[activeIndex + 1] ?? (repeatQueue ? tracks[0] : undefined);
    if (next) afterFadeOut(() => selectTrack(next, playing || Boolean(gap)));
  }
  function previousTrack() {
    cancelGap(); setFinished(false);
    if (time > 3 || activeIndex === 0) afterFadeOut(() => { engine.seek(0); if (playing) play(); });
    else if (tracks[activeIndex - 1]) afterFadeOut(() => selectTrack(tracks[activeIndex - 1], playing));
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (modalOpen || event.altKey || event.ctrlKey || event.metaKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      if (event.repeat) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
      else if (event.key.toLowerCase() === 'm') setSoftened((value) => !value);
      else if (event.key.toLowerCase() === 'f') void toggleFullscreen();
      else if (event.key.toLowerCase() === 'v' && active) chooseVersion(!usingMinusOne);
      else if (event.key === 'ArrowLeft' && active) { event.preventDefault(); cancelGap(); engine.seek(time - 5); }
      else if (event.key === 'ArrowRight' && active) { event.preventDefault(); cancelGap(); engine.seek(Math.min(actualDuration - 0.1, time + 5)); }
      else if (event.key === 'Escape') setStageOnly(false);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active, actualDuration, cancelGap, chooseVersion, engine, modalOpen, time, toggleFullscreen, togglePlayback, usingMinusOne]);

  function updateTrack(updated: Track) {
    setTracks((current) => current.map((track) => track.id === updated.id ? updated : track));
    void storeTrack(updated).catch(storageError);
  }

  function saveMinusOne(id: string, minusOne: Blob) {
    const track = tracks.find((item) => item.id === id);
    if (track) updateTrack({ ...track, minusOne });
  }

  function saveTranscription(id: string, lyrics: LyricLine[]) {
    // The modal is exclusive, so track metadata cannot be edited during this operation.
    const track = tracks.find((item) => item.id === id);
    if (track) updateTrack({ ...track, lyrics, lyricSource: 'transcribed' });
  }

  async function addFiles(files: FileList | File[]) {
    if (importLock.current || !ready) return;
    importLock.current = true;
    setAdding(true);
    const added: Track[] = [];
    const failed: string[] = [];
    let saveFailed = false;
    let duplicates = 0;
    try {
      for (const file of Array.from(files)) {
        if (!/\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i.test(file.name)) { failed.push(`${file.name}: unsupported audio format`); continue; }
        if (file.size > 100 * 1024 * 1024) { failed.push(`${file.name}: larger than 100 MB`); continue; }
        if ([...tracks, ...added].some((track) => track.filename === file.name && track.file.size === file.size)) { duplicates++; continue; }
        try {
          const track: Track = {
            id: crypto.randomUUID(), ...titleFromFilename(file.name), duration: await readDuration(file),
            file, filename: file.name, lyrics: [], offset: 0,
          };
          added.push(track);
          await storeTrack(track).catch(() => { saveFailed = true; });
        } catch { failed.push(`${file.name}: audio could not be read`); }
      }
      if (added.length) {
        setTracks((current) => [...current, ...added]);
        if (!activeId) selectTrack(added[0]);
      }
      if (failed.length) notify(`${added.length} added. ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? `; and ${failed.length - 3} more` : ''}.`, 'error');
      else if (added.length && !saveFailed) notify(`${added.length} song${added.length === 1 ? '' : 's'} added. Add lyrics whenever you’re ready.${duplicates ? ` ${duplicates} duplicate(s) skipped.` : ''}`, 'success');
      else if (duplicates && !added.length) notify('These songs are already in your queue.');
      if (saveFailed) notify(`${added.length} song(s) added for this session, but browser storage is full or unavailable. Keep your original files and export edited lyrics before closing.${failed.length ? ` ${failed.length} file(s) also could not be imported.` : ''}`, 'error');
    } finally { importLock.current = false; setAdding(false); }
  }

  async function moveTrack(index: number, direction: number) {
    const destination = index + direction;
    if (orderLock.current || destination < 0 || destination >= tracks.length) return;
    orderLock.current = true;
    const updated = [...tracks];
    [updated[index], updated[destination]] = [updated[destination], updated[index]];
    const positions = new Map(updated.map((track, position) => [track.id, position]));
    try {
      // Commit before displaying the new order, so an immediate reload cannot undo it.
      await storeOrder(updated.map((track) => track.id)).catch(storageError);
      setTracks((current) => [...current].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity)));
    } finally { orderLock.current = false; }
  }

  function confirmRemove() {
    if (!removeId) return;
    cancelGap();
    const remaining = tracks.filter((track) => track.id !== removeId);
    setTracks(remaining);
    void removeStoredTrack(removeId).catch(storageError);
    if (activeId === removeId) {
      if (remaining[0]) selectTrack(remaining[Math.min(activeIndex, remaining.length - 1)]);
      else { engine.clear(); setActiveId(null); setFinished(false); }
    }
    setRemoveId(null);
    notify('Removed from this queue. Your original audio file is unchanged.');
  }

  function addDemo() {
    const demo = createDemoTrack();
    setTracks((current) => [...current, demo]);
    void storeTrack(demo).catch(storageError);
    selectTrack(demo, true);
    notify('Soundcheck: an original instrumental with practice lyrics. No vocals are recorded.', 'success');
  }

  return <div ref={appRef} className={`app ${isPresenting ? 'presenting' : ''} ${preferences.highContrast ? 'high-contrast' : ''}`} onDragEnter={(event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); dragDepth.current++; setDragging(true);
  }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={(event) => {
    event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); }
  }} onDrop={(event) => {
    event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!modalOpen) void addFiles(event.dataTransfer.files);
  }}>
    <input ref={fileInput} type="file" accept=".mp3,.wav,.m4a,.ogg,.flac,.aac,.webm,audio/*" multiple hidden onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} />
    <header className="topbar">
      <a className="brand" href="/" aria-label="Chorus home" onClick={(event) => event.preventDefault()}><span className="brand-mark"><AudioLines size={25} strokeWidth={2.4} /></span><span>chorus<span className="brand-dot">.</span></span></a>
      <span className="topbar-tagline">A little music. A little togetherness.</span>
      <div className="topbar-actions"><span className="local-badge"><span /> Your room, your songs</span><button className="icon-button" aria-label="Session settings" onClick={() => setSettingsOpen(true)}><Settings2 size={20} /></button></div>
    </header>

    <main className="workspace">
      <aside className="queue-panel" aria-label="Song queue">
        <div className="queue-heading"><div><span className="eyebrow">THE EVENING’S SOUNDTRACK</span><h1>Your song queue<span>{tracks.length.toString().padStart(2, '0')}</span></h1></div></div>
        <button className="upload-zone" onClick={() => fileInput.current?.click()} disabled={adding || !ready}>
          <span className="upload-icon">{adding || !ready ? <LoaderCircle size={22} className="spin" /> : <Plus size={24} />}</span>
          <strong>{!ready ? 'Opening your queue…' : adding ? 'Bringing your songs in…' : 'Bring your songs'}</strong>
          <small>Drop MP3s here, or browse files</small>
          <span className="file-format">MP3, WAV, M4A & more</span>
        </button>
        <div className="queue-meta"><span>{tracks.length ? `${tracks.length} song${tracks.length === 1 ? '' : 's'} · ${formatTime(totalDuration)}` : 'A good evening starts with a song'}</span>{tracks.length > 0 && <span className="autoplay-badge"><Repeat2 size={12} /> Auto-next</span>}</div>
        <ol className="track-list">
          {tracks.map((track, index) => <li key={track.id} className={`track-row ${track.id === activeId ? 'selected' : ''}`}>
            <button className="track-select" onClick={() => { if (track.id !== activeId) afterFadeOut(() => selectTrack(track, playing || Boolean(gap))); }} aria-label={`Select ${track.title}`} aria-current={track.id === activeId ? 'true' : undefined}>
              <span className={`track-number ${track.id === activeId && playing ? 'is-playing' : ''}`}>{track.id === activeId && playing ? <span className="equalizer"><i /><i /><i /></span> : String(index + 1).padStart(2, '0')}</span>
              <span className="track-details"><strong>{track.title}</strong><small>{track.lyrics.some((line) => line.text) ? <><span className="lyrics-dot" /> Lyrics ready</> : <><span className="lyrics-dot pending" /> Needs lyrics</>}{track.minusOne && <span className="minus-one-badge" title="Minus-one ready">Minus-one</span>}<span className="track-duration">{formatTime(track.duration)}</span></small></span>
            </button>
            <div className="track-actions"><button className="tiny-button" disabled={index === 0} aria-label={`Move ${track.title} up`} onClick={() => moveTrack(index, -1)}><ArrowUp size={13} /></button><button className="tiny-button" disabled={index === tracks.length - 1} aria-label={`Move ${track.title} down`} onClick={() => moveTrack(index, 1)}><ArrowDown size={13} /></button><button className="tiny-button remove" disabled={track.id === activeId && playing} title={track.id === activeId && playing ? 'Pause before removing the current song' : 'Remove from queue'} aria-label={`Remove ${track.title}`} onClick={() => setRemoveId(track.id)}><X size={14} /></button></div>
          </li>)}
        </ol>
        {!tracks.length && <div className="empty-queue"><ListMusic size={25} strokeWidth={1.3} /><p>One song or a whole evening.<br /> We’ll keep the music moving.</p></div>}
        <div className="queue-bottom">
          <button className="button transcription-button" disabled={!tracks.length} onClick={() => setTranscribeIds(tracks.filter((track) => !track.lyrics.length).map((track) => track.id).length ? tracks.filter((track) => !track.lyrics.length).map((track) => track.id) : tracks.map((track) => track.id))}><Sparkles size={17} /><span>Generate lyrics</span><span className="ai-label">LOCAL</span></button>
          <button className="button transcription-button" disabled={!tracks.length} onClick={() => { const missing = tracks.filter((track) => !track.minusOne).map((track) => track.id); setMinusOneIds(missing.length ? missing : tracks.map((track) => track.id)); }}><Disc3 size={17} /><span>Make minus-one</span><span className="ai-label">LOCAL</span></button>
          <p className="privacy-caption"><ShieldCheck size={13} /> Music, lyrics & backing tracks stay on this computer.</p>
        </div>
      </aside>

      <section className="main-panel" aria-label="Sing-along stage">
        <div className="section-heading"><div><span className="eyebrow">LESS FUSS. MORE VOICES.</span><h2>Make room for the music.</h2></div><button className="button secondary fullscreen-button" onClick={() => void toggleFullscreen()}><Maximize size={16} /> Fullscreen <kbd>F</kbd></button></div>
        <section className={`lyric-stage ${active ? 'has-song' : ''}`} aria-label="Lyrics" style={{ '--lyric-size': `${preferences.fontSize}px` } as CSSProperties}>
          <div className="stage-grain" aria-hidden="true" />
          <div className="stage-topline"><span className="stage-label"><span className={playing && !fading ? 'live-dot live' : 'live-dot'} />{gap ? 'UP NEXT' : !active ? 'THE STAGE IS YOURS' : fading ? 'FADING TO PAUSE' : playing ? 'NOW SINGING' : 'READY WHEN YOU ARE'}</span><div className="stage-top-actions">{active && <span className="stage-song-number">{String(activeIndex + 1).padStart(2, '0')} / {String(tracks.length).padStart(2, '0')}</span>}{isPresenting && <button className="icon-button light" aria-label="Exit fullscreen" onClick={() => void toggleFullscreen()}><Minimize size={20} /></button>}</div></div>
          <FadeThrough viewKey={stageView}>
            {!active ? <div className="welcome-stage"><span className="stage-illustration"><AudioLines size={48} strokeWidth={1.1} /><span /><span /></span><p className="welcome-kicker">GOOD SONGS ARE BETTER SHARED</p><h3>Bring the songs.<br /><em>Sing them together.</em></h3><p>Add your MP3s. Find the words.<br />Let the next song take care of itself.</p><button className="button stage-cta" disabled={!ready} onClick={() => fileInput.current?.click()}><Plus size={17} /> Add your first songs</button><button className="demo-link" disabled={!ready} onClick={addDemo}><Headphones size={14} /> Or try a 32-second soundcheck</button></div>
            : gap ? <div className="gap-content"><span className="countdown">{gap.remaining}</span><p>A little room to breathe.</p><h3>{tracks.find((track) => track.id === gap.nextId)?.title}</h3><button className="button stage-cta" onClick={() => { const next = tracks.find((track) => track.id === gap.nextId); if (next) selectTrack(next, true); }}>Start next song <SkipForward size={15} /></button></div>
            : finished ? <div className="finished-content"><span className="finished-icon"><Check size={32} /></span><p className="welcome-kicker">THAT WAS A LOVELY LITTLE SESSION</p><h3>Every voice.<br /><em>Part of the song.</em></h3><p>You’ve reached the end of your queue.</p><button className="button stage-cta" onClick={() => tracks[0] && selectTrack(tracks[0], true)}><RotateCcw size={16} /> Sing it again</button></div>
            : !hasLyrics ? <div className="no-lyrics"><Music2 size={36} strokeWidth={1.2} /><p className="welcome-kicker">A SONG WAITING FOR ITS WORDS</p><h3>{active.title}</h3><p>The music is ready. Let’s add something to sing.</p><div className="stage-buttons"><button className="button stage-cta" onClick={() => setTranscribeIds([active.id])}><Sparkles size={16} /> Generate lyrics</button><button className="button stage-secondary" onClick={() => setEditing(true)}><FileText size={16} /> Add lyrics</button></div><small>Or just press play and enjoy the music.</small></div>
            : <LyricStack trackId={active.id} lines={active.lyrics} window={lyricWin!} durationMs={lyricMs} pause={<>
              <span className="instrumental-notes"><Music2 size={30} /></span>
              {nextLine ? (time < active.lyrics[0].start + active.offset ? 'The song is about to begin' : 'Let the music breathe') : 'Let the last notes linger'}
              {nextLine && <span className="lyrics-count-in">Words in {Math.max(1, Math.ceil(nextLine.start + active.offset - time))}s</span>}
            </>} />}
          </FadeThrough>
          <div className="stage-bottomline"><span>{active ? <><Music2 size={13} /> {active.title}{usingMinusOne && <span className="stage-version">Minus-one</span>}</> : <><Waves size={15} /> A space for every voice</>}</span><div className="stage-caption-tools"><button aria-label="Smaller lyrics" disabled={preferences.fontSize <= 32} onClick={() => setPreferences((value) => ({ ...value, fontSize: Math.max(32, value.fontSize - 4) }))}>A<span>−</span></button><span className="caption-tool-divider" /><button aria-label="Larger lyrics" disabled={preferences.fontSize >= 88} onClick={() => setPreferences((value) => ({ ...value, fontSize: Math.min(88, value.fontSize + 4) }))}>A<span>+</span></button></div></div>
        </section>
        <div className="under-stage"><div className="stage-note"><span className="note-dot" /><span>{hasLyrics ? `${active?.lyrics.filter((line) => line.text).length} lines · ${active?.lyricSource === 'transcribed' ? 'AI lyrics — please review' : 'Timed lyrics ready'}` : 'Big words. Shared moments. No page-turning.'}</span></div><div className="lyric-actions">{active && hasLyrics && <div className="offset-controls"><span>Lyric delay</span><button aria-label="Show lyrics 0.5 seconds earlier" onClick={() => updateTrack({ ...active, offset: Math.max(-30, Math.round((active.offset - 0.5) * 10) / 10) })}>−</button><span className="mono" title="Positive values show lyrics later">{active.offset > 0 ? '+' : ''}{active.offset.toFixed(1)}s</span><button aria-label="Show lyrics 0.5 seconds later" onClick={() => updateTrack({ ...active, offset: Math.min(30, Math.round((active.offset + 0.5) * 10) / 10) })}>+</button></div>}{active && <button className="text-button" onClick={() => setDownloadOpen(true)}><Download size={14} />Download</button>}{active && <button className="text-button" onClick={() => setEditing(true)}><FileText size={14} />{hasLyrics ? 'Edit lyrics' : 'Add lyrics'}</button>}</div></div>
        <div className="feature-strip"><div><span className="feature-icon"><ListMusic size={19} /></span><span><strong>One seamless queue</strong><small>From the first song to the last.</small></span></div><div><span className="feature-icon"><Volume1 size={20} /></span><span><strong>A gentler kind of pause</strong><small>Fade out. Take a breath. Carry on.</small></span></div><div><span className="feature-icon"><CloudOff size={18} /></span><span><strong>At home on your device</strong><small>Your files. Your gathering.</small></span></div></div>
      </section>
    </main>

    <footer className="player" aria-label="Playback controls">
      <div className="player-song"><span className={`album-art ${playing ? 'album-playing' : ''}`}><AudioLines size={25} /></span><div><strong>{active?.title ?? 'Your next sing-along starts here'}</strong><small>{gap ? `Next song in ${gap.remaining}s` : fading ? 'Fading gently… your song stays in the queue' : softened ? 'Music softened · your place is kept' : active?.artist || (active ? 'Ready when you are' : 'Add a few songs to get things going')}</small>{active && <div className="version-toggle" role="group" aria-label="Playback version"><button aria-pressed={!usingMinusOne} onClick={() => chooseVersion(false)}>Original</button><button aria-pressed={usingMinusOne} title={active.minusOne ? 'Vocals removed · V' : 'Make a minus-one for this song'} onClick={() => chooseVersion(true)}>Minus-one</button></div>}</div></div>
      <div className="transport"><div className="transport-buttons"><span className="repeat-group"><span className={`repeat-scope ${preferences.repeat ? 'visible' : ''}`} role="group" aria-label="Repeat scope"><button aria-pressed={!repeatSong} title="Repeat the whole queue" onClick={() => setPreferences((value) => ({ ...value, repeatMode: 'queue' }))}>Queue</button><button aria-pressed={repeatSong} title="Repeat this song" onClick={() => setPreferences((value) => ({ ...value, repeatMode: 'song' }))}>Song</button></span><button className={`icon-button repeat-button ${preferences.repeat ? 'enabled' : ''}`} aria-label="Repeat" aria-pressed={preferences.repeat} title={!preferences.repeat ? 'Repeat is off' : repeatSong ? 'Repeating this song' : 'Repeating the whole queue'} onClick={() => setPreferences((value) => ({ ...value, repeat: !value.repeat }))}><span className="repeat-icon"><Repeat2 size={18} /></span></button></span><button className="icon-button" aria-label="Previous song or restart" disabled={!active} onClick={previousTrack}><SkipBack size={21} fill="currentColor" /></button><button className={`play-button ${fading ? 'fading' : ''}`} aria-label={gap ? 'Pause auto-advance' : playing && !fading ? 'Pause with fade' : 'Play'} disabled={!active} onClick={togglePlayback}>{gap || (playing && !fading) ? <Pause size={23} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button><button className="icon-button" aria-label="Next song" disabled={!active || (activeIndex === tracks.length - 1 && !repeatQueue)} onClick={nextTrack}><SkipForward size={21} fill="currentColor" /></button><span className="transport-spacer" /></div><div className="seek-row"><span>{formatTime(time)}</span><input type="range" aria-label="Song position" aria-valuetext={`${formatTime(time)} of ${formatTime(actualDuration)}`} min={0} max={actualDuration || 1} step={0.1} value={Math.min(time, actualDuration || 1)} disabled={!active || !duration} style={{ '--progress': `${actualDuration ? time / actualDuration * 100 : 0}%` } as CSSProperties} onChange={(event) => { cancelGap(); setFinished(false); engine.seek(Number(event.target.value)); }} /><span>{formatTime(actualDuration)}</span></div></div>
      <div className="volume-controls"><button className={`soften-button ${softened ? 'softened' : ''}`} disabled={!active} aria-pressed={softened} title="Gently lower music to 22% · M" onClick={() => setSoftened((value) => !value)}><Waves size={17} /><span>{softened ? 'Restore' : 'Soften'}</span></button><div className="volume-slider">{preferences.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}<input type="range" min={0} max={1} step={0.01} value={preferences.volume} aria-label="Volume" aria-valuetext={`${Math.round(preferences.volume * 100)} percent`} style={{ '--progress': `${preferences.volume * 100}%` } as CSSProperties} onChange={(event) => setPreferences((value) => ({ ...value, volume: Number(event.target.value) }))} /></div></div>
    </footer>
    <div className="page-footer"><span>MADE FOR THE MOMENTS BETWEEN US</span><span>{tracks.length ? `${readyLyrics} of ${tracks.length} songs with lyrics` : 'No account. Just your music.'}<span className="footer-divider">/</span><kbd>Space</kbd> to play or pause</span></div>

    {notice && <div className={`toast ${notice.kind || ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {dragging && !modalOpen && <div className="drop-overlay"><Upload size={48} /><h2>Good songs belong here.</h2><p>Drop your audio files to add them to the queue.</p></div>}
    {settingsOpen && <Settings preferences={preferences} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />}
    {editing && active && <LyricsEditor track={active} time={time} playing={playing && !fading} onToggle={togglePlayback} onSave={updateTrack} onClose={() => setEditing(false)} />}
    {transcribeIds && <TranscriptionDialog tracks={tracks.filter((track) => transcribeIds.includes(track.id))} onSave={saveTranscription} onClose={() => setTranscribeIds(null)} />}
    {minusOneIds && <MinusOneDialog tracks={tracks.filter((track) => minusOneIds.includes(track.id))} onSave={saveMinusOne} onClose={() => setMinusOneIds(null)} />}
    {downloadOpen && active && <DownloadDialog track={active} onMakeMinusOne={() => { setDownloadOpen(false); setMinusOneIds([active.id]); }} onClose={() => setDownloadOpen(false)} />}
    {removeId && <Modal title="Remove this song?" subtitle={tracks.find((track) => track.id === removeId)?.title} onClose={() => setRemoveId(null)}><p className="remove-explanation">This removes the song, its minus-one, and its saved lyrics from this browser’s queue. It does not delete your original audio file.</p><footer className="modal-footer"><button className="button secondary" onClick={() => setRemoveId(null)}>Keep song</button><button className="button danger" onClick={confirmRemove}><Trash2 size={16} /> Remove song</button></footer></Modal>}
    {isPresenting && <button className="presenting-hint" onClick={() => void toggleFullscreen()}><ChevronDown size={15} /> Back to your room</button>}
  </div>;
}

export default App;
