/**
 * Study column that slides in/out from the right edge of the player (ported
 * from .mock/src/app/components/ui/SlideColumn.tsx). The inner width is
 * FROZEN during the transition so the panel tabs never reflow, and the child
 * stays mounted (aria-hidden + data-kvl-closing) until width's transitionend
 * or a timeout fallback for hidden tabs / happy-dom.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface SlideColumnProps {
  open: boolean;
  widthPx: number;
  children: React.ReactNode;
  hostRef?: React.MutableRefObject<HTMLDivElement | null> | ((node: HTMLDivElement | null) => void);
  className?: string;
  /**
   * PR #170: swap WITHOUT animating the width.
   *
   * The rail and the docked panel share one slot and one width. Alternating
   * them with the 300 ms width animation would, for the length of the
   * transition, reserve neither of them (or both) and re-letterbox the video.
   * With `instant` the column takes — or gives up — its slot in the same frame
   * and the CONTENT carries the transition; the width animation stays for
   * opening from closed and for closing the last column.
   */
  instant?: boolean;
}

export function SlideColumn({ open, widthPx, children, hostRef, className = '', instant = false }: SlideColumnProps) {
  const [mounted, setMounted] = useState(open);
  // Even an initially open column starts collapsed: the double-rAF in the
  // layout effect animates 0px → widthPx on the FIRST open, not just later ones.
  const [shown, setShown] = useState(instant && open);
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setMounted(true);
    else if (inner.current) inner.current.style.width = `${inner.current.offsetWidth}px`;
    if (!open) setShown(false);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !mounted || shown) return;
    if (inner.current) inner.current.style.width = `${widthPx}px`;
    if (instant) {
      // No animation to wait for: the column is at its width now.
      setShown(true);
      return;
    }
    let id2 = 0;
    let settled = false;
    const reveal = () => {
      if (settled) return;
      settled = true;
      setShown(true);
    };
    const id = requestAnimationFrame(() => { id2 = requestAnimationFrame(reveal); });
    // An occluded tab can starve rAF; the column must still open.
    const fallback = window.setTimeout(reveal, 80);
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(id2);
      window.clearTimeout(fallback);
    };
  }, [open, mounted, shown, widthPx, instant]);

  // Fallback: a hidden tab never delivers transitionend; unmount anyway.
  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), 340);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  const onEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'width') return;
    if (!open) setMounted(false);
    else if (inner.current) inner.current.style.width = '';
  };

  if (!mounted) return null;
  return (
    <div
      ref={(node) => {
        outer.current = node;
        if (typeof hostRef === 'function') hostRef(node);
        else if (hostRef && typeof hostRef === 'object') Object.assign(hostRef, { current: node });
      }}
      onTransitionEnd={onEnd}
      data-kvl-slide=""
      data-kvl-closing={!open ? '' : undefined}
      aria-hidden={!open || undefined}
      className={`${className} shrink-0 h-full flex justify-end overflow-hidden ${instant ? 'transition-opacity duration-150' : 'transition-[width,opacity] duration-300'} ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none ${
        shown ? 'opacity-100' : 'w-0 opacity-0'
      } ${!open ? 'pointer-events-none' : ''}`}
      style={shown ? { width: `${widthPx}px` } : undefined}
    >
      <div
        ref={inner}
        className="h-full w-full shrink-0 [&>*]:!w-full [&>*]:!animate-none [&>.contents>*]:!w-full [&>.contents>*]:!animate-none"
        style={{ width: `${widthPx}px` }}
      >
        {children}
      </div>
    </div>
  );
}
