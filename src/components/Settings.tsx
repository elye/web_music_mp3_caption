import { Moon, Repeat2, Sparkles } from 'lucide-react';
import type { Preferences } from '../types';
import { Modal } from './Modal';

export function Settings({ preferences, onChange, onClose }: {
  preferences: Preferences; onChange: (value: Preferences) => void; onClose: () => void;
}) {
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => onChange({ ...preferences, [key]: value });
  return <Modal title="Set the mood" subtitle="Small details for a smoother sing-along." onClose={onClose}>
    <div className="settings-stack">
      <label className="setting-row"><span><strong>Music volume</strong><small>{Math.round(preferences.volume * 100)}% · independent of your device volume</small></span><input className="settings-volume" type="range" aria-label="Music volume" min={0} max={1} step={0.01} value={preferences.volume} onChange={(e) => set('volume', Number(e.target.value))} /></label>
      <label className="setting-row"><span><strong>Between songs</strong><small>A little room to breathe before the next song.</small></span><select aria-label="Gap between songs" value={preferences.gap} onChange={(e) => set('gap', Number(e.target.value))}><option value={0}>No gap</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label>
      <label className="setting-row"><span><strong>Fade-out on pause</strong><small>Ease out gently, keeping your place.</small></span><select aria-label="Fade-out duration" value={preferences.fade} onChange={(e) => set('fade', Number(e.target.value))}><option value={0.6}>Quick · 0.6s</option><option value={1.2}>Gentle · 1.2s</option><option value={2.5}>Slow · 2.5s</option></select></label>
      <div className="setting-row"><span><strong><Repeat2 size={16} /> Repeat the queue</strong><small>Return to the first song after the last one.</small></span><button className="switch" role="switch" aria-label="Repeat the queue" aria-checked={preferences.repeat} onClick={() => set('repeat', !preferences.repeat)}><span /></button></div>
      <div className="setting-row"><span><strong><Moon size={16} /> High-contrast lyrics</strong><small>Pure black and white for projectors.</small></span><button className="switch" role="switch" aria-label="High-contrast lyrics" aria-checked={preferences.highContrast} onClick={() => set('highContrast', !preferences.highContrast)}><span /></button></div>
    </div>
    <div className="info-card"><Sparkles size={20} /><p><strong>Give the room a moment.</strong> The Soften button lowers music to 22% of your chosen volume. Tap it again to gently bring the music back.</p></div>
    <div className="shortcut-list"><h3>At your fingertips</h3><div><span>Play / gentle pause</span><kbd>Space</kbd></div><div><span>Soften / restore music</span><kbd>M</kbd></div><div><span>Fullscreen</span><kbd>F</kbd></div><div><span>Seek 5 seconds</span><span><kbd>←</kbd> <kbd>→</kbd></span></div></div>
    <footer className="modal-footer"><button className="button primary" onClick={onClose}>All set</button></footer>
  </Modal>;
}
