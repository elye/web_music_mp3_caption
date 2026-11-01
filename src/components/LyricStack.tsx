import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { LyricWindow } from '../lib/lyrics';

const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

interface WordSnap {
  centerX: number; centerY: number; width: number; height: number;
  text: string; layoutFont: number;
  /** Font size as currently seen, including scale from an animation in flight. */
  fontSize: number;
  style: Pick<CSSStyleDeclaration, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'letterSpacing' | 'color'>;
}

interface Snapshot {
  centerX: number; centerY: number;
  /** Layout size (unaffected by transforms) and font size. */
  width: number; height: number; layoutFont: number;
  /** Font size as currently seen, i.e. including any scale from an animation in flight. */
  fontSize: number;
  fontFamily: string;
  words: WordSnap[];
  node: HTMLElement;
}
interface Captured { trackId: string; items: Map<string, Snapshot>; stageHeight: number | null }

/**
 * Would simply scaling the old appearance of this line into its new box put every word where it really was?
 * If the words wrap differently at the new size (a word hopping to another row, one row becoming three) the
 * answer is no, and the words have to travel individually.
 */
function wrapsDifferently(node: HTMLElement, old: Snapshot, rect: DOMRect, newFont: number): boolean {
  const scale = old.fontSize / newFont;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  let worst = 0;
  node.querySelectorAll<HTMLElement>('.lyric-word').forEach((word, i) => {
    const before = old.words[i];
    if (!before) return;
    const r = word.getBoundingClientRect();
    const expectedX = old.centerX + scale * (r.left + r.width / 2 - centerX);
    const expectedY = old.centerY + scale * (r.top + r.height / 2 - centerY);
    worst = Math.max(worst, Math.hypot(expectedX - before.centerX, expectedY - before.centerY));
  });
  return worst > Math.max(4, old.fontSize * 0.2);
}

/** Reads where every line and word visually is right now (including any animation in flight). */
function capture(root: HTMLElement, trackId: string): Captured {
  const items = new Map<string, Snapshot>();
  root.querySelectorAll<HTMLElement>('[data-lyric-key]').forEach((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const scale = new DOMMatrix(style.transform === 'none' ? undefined : style.transform).a || 1;
    const layoutFont = parseFloat(style.fontSize);
    const words = [...node.querySelectorAll<HTMLElement>('.lyric-word')].map((word): WordSnap => {
      const wordRect = word.getBoundingClientRect();
      const wordStyle = getComputedStyle(word);
      const wordFont = parseFloat(wordStyle.fontSize);
      return {
        centerX: wordRect.left + wordRect.width / 2, centerY: wordRect.top + wordRect.height / 2,
        width: word.offsetWidth, height: word.offsetHeight, text: word.textContent ?? '', layoutFont: wordFont,
        fontSize: wordFont * (word.offsetWidth > 0 ? wordRect.width / word.offsetWidth : 1),
        style: {
          fontFamily: wordStyle.fontFamily, fontWeight: wordStyle.fontWeight, fontStyle: wordStyle.fontStyle,
          letterSpacing: wordStyle.letterSpacing, color: wordStyle.color,
        },
      };
    });
    items.set(node.dataset.lyricKey!, {
      centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2,
      width: node.offsetWidth, height: node.offsetHeight, layoutFont, fontSize: layoutFont * scale,
      fontFamily: style.fontFamily, words, node: node.cloneNode(true) as HTMLElement,
    });
  });
  const stage = root.closest<HTMLElement>('.lyric-stage');
  return { trackId, items, stageHeight: stage ? stage.getBoundingClientRect().height : null };
}

/** Puts a copy of a line's previous appearance exactly where it was, in the overlay layer. */
function placeGhost(old: Snapshot, boxRect: DOMRect, layer: HTMLElement): HTMLElement {
  const ghost = old.node;
  ghost.removeAttribute('data-lyric-key');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'absolute', margin: '0', pointerEvents: 'none', width: `${old.width}px`,
    left: `${old.centerX - boxRect.left - old.width / 2}px`, top: `${old.centerY - boxRect.top - old.height / 2}px`,
  });
  layer.appendChild(ghost);
  return ghost;
}

/** A stand-in for one word as it used to look (old typeface and size), floating where it used to be. */
function placeWordGhost(word: WordSnap, boxRect: DOMRect, layer: HTMLElement): HTMLElement {
  const ghost = document.createElement('span');
  ghost.textContent = word.text;
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'absolute', pointerEvents: 'none', whiteSpace: 'nowrap', textAlign: 'center',
    width: `${word.width}px`, height: `${word.height}px`, lineHeight: `${word.height}px`,
    left: `${word.centerX - boxRect.left - word.width / 2}px`, top: `${word.centerY - boxRect.top - word.height / 2}px`,
    fontSize: `${word.layoutFont}px`, ...word.style,
  });
  layer.appendChild(ghost);
  return ghost;
}

/**
 * Morphs a line between two real layouts (e.g. one wide row at a small size into three rows at a big size).
 * The new layout is already in the DOM and measured as it will really be on this screen, so each word is
 * animated from where it was to where it now is. If the typeface changes too, the old-typeface word is
 * kept as a ghost that travels along with it and dissolves into the new one.
 */
function morphWords(node: HTMLElement, old: Snapshot, boxRect: DOMRect, layer: HTMLElement, duration: number, fontChanged: boolean) {
  const newFont = parseFloat(getComputedStyle(node).fontSize);
  node.querySelectorAll<HTMLElement>('.lyric-word').forEach((word, i) => {
    const before = old.words[i];
    if (!before) return;
    const rect = word.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const from = `translate(${before.centerX - centerX}px, ${before.centerY - centerY}px) scale(${before.fontSize / newFont})`;
    word.animate(
      [{ transform: from, opacity: fontChanged ? 0 : 1 }, { transform: 'none', opacity: 1 }],
      { duration, easing: EASING },
    );
    if (!fontChanged) return;
    const ghost = placeWordGhost(before, boxRect, layer);
    ghost.animate(
      [
        { opacity: 1, transform: `scale(${before.fontSize / before.layoutFont})` },
        { opacity: 0, transform: `translate(${centerX - before.centerX}px, ${centerY - before.centerY}px) scale(${newFont / before.layoutFont})` },
      ],
      { duration, easing: EASING },
    ).finished.then(() => ghost.remove(), () => ghost.remove());
  });
}

/** Splits a lyric into word boxes (kept as inline-blocks so they wrap exactly like normal text). */
function Words({ text }: { text: string }) {
  return <>{text.split(/(\s+)/).map((part, i) => (part === '' || /^\s+$/.test(part) ? part : <span className="lyric-word" key={i}>{part}</span>))}</>;
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
 * Lines live in normal flow (so multi-line lyrics never overlap). When the window moves, each line is
 * measured before and after the change and animated from its old position and size to the new one.
 * Small lyrics use the full width and only wrap once they are big, so when a line changes size the
 * words themselves travel between the two layouts.
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
    let observer: ResizeObserver | undefined;
    if (!before || !root || !layer || !box || before.trackId !== trackId) return;
    const DURATION = duration.current;
    // Set before any measurement forces a style recalc, so the colour fade matches the motion.
    box.style.setProperty('--lyric-ms', `${DURATION}ms`);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // The stage grows and shrinks with the number of wrapped lines. Animate its height too, otherwise the whole
    // card (and everything below it) snaps. Pinning min/max height works whichever way the card is changing.
    // The lines are measured *after* this, so their glide starts from where they really are in the animating card.
    const stage = box.closest<HTMLElement>('.lyric-stage');
    if (stage && before.stageHeight !== null) {
      stage.getAnimations().forEach((animation) => animation.cancel());
      const to = stage.getBoundingClientRect().height;
      if (Math.abs(to - before.stageHeight) > 1) {
        const pin = (px: number) => ({ minHeight: `${px}px`, maxHeight: `${px}px` });
        const first = stage.animate([pin(before.stageHeight), pin(to)], { duration: DURATION, easing: EASING });
        // If the text re-wraps while the card is moving (a late font, a window resize), re-aim at the new height
        // instead of snapping to it when the animation ends.
        let current = first;
        let lastHeight = root.offsetHeight;
        observer = new ResizeObserver(() => {
          if (Math.abs(root.offsetHeight - lastHeight) < 1 || current.playState !== 'running') return;
          lastHeight = root.offsetHeight;
          const from = stage.getBoundingClientRect().height;
          const remaining = Math.max(400, DURATION - Number(current.currentTime ?? 0));
          current.cancel();
          const target = stage.getBoundingClientRect().height;
          if (Math.abs(target - from) > 1) current = stage.animate([pin(from), pin(target)], { duration: remaining, easing: EASING });
        });
        observer.observe(root);
      }
    }

    const boxRect = box.getBoundingClientRect();
    const seen = new Set<string>();
    root.querySelectorAll<HTMLElement>('[data-lyric-key]').forEach((node) => {
      const key = node.dataset.lyricKey!;
      seen.add(key);
      node.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
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
      const style = getComputedStyle(node);
      const newFont = parseFloat(style.fontSize);
      const fontChanged = style.fontFamily !== old.fontFamily;
      const reshaped = !fontChanged && wrapsDifferently(node, old, rect, newFont);
      if (fontChanged || reshaped) {
        morphWords(node, old, boxRect, layer, DURATION, fontChanged);
        return;
      }
      const dy = old.centerY - (rect.top + rect.height / 2);
      const scale = old.fontSize / newFont;
      if (Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.01) return;
      node.animate(
        [{ transform: `translateY(${dy}px) scale(${scale})` }, { transform: 'translateY(0) scale(1)' }],
        { duration: DURATION, easing: EASING },
      );
    });

    // Lines that left the window glide up and fade out from where they were.
    before.items.forEach((old, key) => {
      if (seen.has(key)) return;
      const ghost = placeGhost(old, boxRect, layer);
      ghost.animate(
        [
          { opacity: 1, transform: `translateY(0) scale(${old.fontSize / old.layoutFont})`, offset: 0 },
          { opacity: 0, offset: 0.45 },
          { opacity: 0, transform: `translateY(-40px) scale(${old.fontSize / old.layoutFont})`, offset: 1 },
        ],
        { duration: DURATION, easing: EASING },
      ).finished.then(() => ghost.remove(), () => ghost.remove());
    });
    return () => observer?.disconnect();
  }, [signature, trackId]);

  const lineProps = (index: number, role: string) => ({
    'data-lyric-key': `${trackId}-${index}`,
    className: `${role}-lyric`,
  });

  return <div className="caption-stack" ref={stack}>
    <div className="lyric-flow" ref={flow}>
      {w.previous >= 0 && <p key={`${trackId}-${w.previous}`} {...lineProps(w.previous, 'previous')} aria-hidden="true"><Words text={lines[w.previous].text} /></p>}
      {w.current >= 0
        ? <p key={`${trackId}-${w.current}`} {...lineProps(w.current, 'current')}><Words text={lines[w.current].text} /></p>
        : <div key="pause" className="current-lyric instrumental" data-lyric-key="pause">{pause}</div>}
      {w.next >= 0 && <p key={`${trackId}-${w.next}`} {...lineProps(w.next, 'next')}><Words text={lines[w.next].text} /></p>}
      {w.after >= 0 && <p key={`${trackId}-${w.after}`} {...lineProps(w.after, 'after')} aria-hidden="true"><Words text={lines[w.after].text} /></p>}
    </div>
    <div className="lyric-ghosts" ref={ghosts} aria-hidden="true" />
  </div>;
}
