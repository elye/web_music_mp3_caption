import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { LyricWindow } from '../lib/lyrics';

const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

interface Snapshot { centerY: number; left: number; width: number; height: number; fontSize: number; node: HTMLElement }
interface Captured { trackId: string; items: Map<string, Snapshot> }

/** Reads where every line visually is right now (including any animation in flight). */
function capture(root: HTMLElement, trackId: string): Captured {
  const items = new Map<string, Snapshot>();
  root.querySelectorAll<HTMLElement>('[data-lyric-key]').forEach((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const scale = new DOMMatrix(style.transform === 'none' ? undefined : style.transform).a || 1;
    items.set(node.dataset.lyricKey!, {
      centerY: rect.top + rect.height / 2, left: rect.left, width: rect.width, height: rect.height,
      fontSize: parseFloat(style.fontSize) * scale, node: node.cloneNode(true) as HTMLElement,
    });
  });
  return { trackId, items };
}

interface Props {
  trackId: string;
  lines: { text: string }[];
  window: LyricWindow;
  /** How long the next move takes; longer when there is more time before the following change. */
  durationMs: number;
  /** Shown in the current slot while nobody is singing. */
  pause: ReactNode;
}

/**
 * Lines live in normal flow (so multi-line lyrics never overlap). When the window moves, each
 * line is measured before and after the change and animated from its old position and size to
 * the new one, which reads as a smooth upward scroll with the font growing or shrinking.
 */
export function LyricStack({ trackId, lines, window: w, durationMs, pause }: Props) {
  const duration = useRef(durationMs);
  duration.current = durationMs;
  const stack = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const pending = useRef<Captured | null>(null);
  const signature = `${trackId}|${w.previous}|${w.current}|${w.next}|${w.after}`;
  const committed = useRef(signature);

  // Render runs before React touches the DOM, so this still sees the previous (possibly mid-animation) layout.
  if (signature !== committed.current && flow.current && !pending.current) pending.current = capture(flow.current, trackId);

  useLayoutEffect(() => {
    committed.current = signature;
    const before = pending.current;
    pending.current = null;
    const root = flow.current;
    const layer = ghosts.current;
    const box = stack.current;
    if (!before || !root || !layer || !box || before.trackId !== trackId) return;
    const DURATION = duration.current;
    // Set before any measurement forces a style recalc, so the colour fade matches the motion.
    box.style.setProperty('--lyric-ms', `${DURATION}ms`);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const boxRect = box.getBoundingClientRect();
    const seen = new Set<string>();
    root.querySelectorAll<HTMLElement>('[data-lyric-key]').forEach((node) => {
      const key = node.dataset.lyricKey!;
      seen.add(key);
      node.getAnimations().forEach((animation) => animation.cancel());
      const old = before.items.get(key);
      const rect = node.getBoundingClientRect();
      if (!old) {
        const opacity = getComputedStyle(node).opacity;
        node.animate(
          [
            { opacity: 0, transform: 'translateY(36px)', offset: 0 },
            { opacity: 0, transform: 'translateY(30px)', offset: 0.2 },
            { opacity, transform: 'translateY(0)', offset: 1 },
          ],
          { duration: DURATION, easing: EASING },
        );
        return;
      }
      const dy = old.centerY - (rect.top + rect.height / 2);
      const scale = old.fontSize / parseFloat(getComputedStyle(node).fontSize);
      if (Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.01) return;
      node.animate(
        [{ transform: `translateY(${dy}px) scale(${scale})` }, { transform: 'translateY(0) scale(1)' }],
        { duration: DURATION, easing: EASING },
      );
    });

    // Lines that left the window glide up and fade out from where they were.
    before.items.forEach((old, key) => {
      if (seen.has(key)) return;
      const ghost = old.node;
      ghost.removeAttribute('data-lyric-key');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, {
        position: 'absolute', margin: '0', pointerEvents: 'none',
        left: `${old.left - boxRect.left}px`, top: `${old.centerY - boxRect.top - old.height / 2}px`, width: `${old.width}px`,
      });
      layer.appendChild(ghost);
      ghost.animate(
        [
          { opacity: 1, transform: 'translateY(0)', offset: 0 },
          { opacity: 0, offset: 0.45 },
          { opacity: 0, transform: 'translateY(-40px)', offset: 1 },
        ],
        { duration: DURATION, easing: EASING },
      ).finished.then(() => ghost.remove(), () => ghost.remove());
    });
  }, [signature, trackId]);

  const lineProps = (index: number, role: string) => ({
    'data-lyric-key': `${trackId}-${index}`,
    className: `${role}-lyric`,
  });

  return <div className="caption-stack" ref={stack}>
    <div className="lyric-flow" ref={flow}>
      {w.previous >= 0 && <p key={`${trackId}-${w.previous}`} {...lineProps(w.previous, 'previous')} aria-hidden="true">{lines[w.previous].text}</p>}
      {w.current >= 0
        ? <p key={`${trackId}-${w.current}`} {...lineProps(w.current, 'current')}>{lines[w.current].text}</p>
        : <div key="pause" className="current-lyric instrumental" data-lyric-key="pause">{pause}</div>}
      {w.next >= 0 && <p key={`${trackId}-${w.next}`} {...lineProps(w.next, 'next')}>{lines[w.next].text}</p>}
      {w.after >= 0 && <p key={`${trackId}-${w.after}`} {...lineProps(w.after, 'after')} aria-hidden="true">{lines[w.after].text}</p>}
    </div>
    <div className="lyric-ghosts" ref={ghosts} aria-hidden="true" />
  </div>;
}
