import { useEffect, useRef, useState, type ReactNode } from 'react';

const OUT_MS = 300;

interface Props {
  /** Changes whenever the stage should show something different (another song, the gap screen, the end screen...). */
  viewKey: string;
  children: ReactNode;
}

/**
 * The stage's content area. When `viewKey` changes, the old content stays on screen while it fades out, then the
 * new content is mounted and fades in, so moving between songs never just cuts.
 */
export function FadeThrough({ viewKey, children }: Props) {
  const [shown, setShown] = useState(viewKey);
  const changed = useRef(false);
  const latest = useRef(children);
  if (viewKey === shown) latest.current = children;

  useEffect(() => {
    if (viewKey === shown) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => {
      changed.current = true;
      setShown(viewKey);
    }, reduceMotion ? 0 : OUT_MS);
    return () => clearTimeout(timer);
  }, [viewKey, shown]);

  const leaving = viewKey !== shown;
  return (
    <div key={shown} className={`lyrics-content${leaving ? ' is-leaving' : changed.current ? ' is-entering' : ''}`}>
      {leaving ? latest.current : children}
    </div>
  );
}
