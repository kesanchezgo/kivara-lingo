import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../shared/i18n';
import { Info } from '../../ui/icons';
import { usePortalContainer } from '../../ui/portal';

interface InfoHintProps {
  /** Text or node shown inside the tooltip. */
  text: React.ReactNode;
  /** Icon size in px. Default: 13. */
  size?: number;
  /** Tooltip max width. Default: 240. */
  maxWidth?: number;
  /** Extra class on the icon wrapper. */
  className?: string;
}

interface ResolvedPos {
  top: number;
  left: number;
  side: 'top' | 'bottom';
  align: 'start' | 'end';
}

const GAP = 6;
const VIEWPORT_PAD = 8;

/**
 * Info icon with a custom tooltip rendered through a portal.
 *
 * The portal target comes from `usePortalContainer()`: the content script's
 * shadow host supplies a node INSIDE its closed root (a portal to
 * `document.body` would be invisible and unreachable), while extension pages
 * fall back to `document.body`. Positioning is the repo's two-pass measurement
 * — a layout pass before paint and a rAF pass once the tooltip has real
 * dimensions — so it never flashes at an off-screen coordinate.
 */
export function InfoHint({ text, size = 13, maxWidth = 240, className = '' }: InfoHintProps) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<ResolvedPos | null>(null);
  const [isDark, setIsDark] = useState(false);

  const calcPos = useCallback(() => {
    if (!open || !triggerRef.current) return;
    const triggerEl = triggerRef.current;
    const rect = triggerEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // The nearest theme scope wins: a `.light` card inside a dark app stays light.
    setIsDark(!!triggerEl.closest('.dark, .light')?.classList.contains('dark'));

    const tipEl = tipRef.current;
    const tipW = (tipEl?.offsetWidth ?? 0) || Math.min(maxWidth, 220);
    const tipH = (tipEl?.offsetHeight ?? 0) || 48;

    const spaceBelow = vh - rect.bottom - VIEWPORT_PAD;
    const spaceAbove = rect.top - VIEWPORT_PAD;
    const side: 'top' | 'bottom' =
      spaceBelow >= tipH + GAP ? 'bottom'
      : spaceAbove >= tipH + GAP ? 'top'
      : spaceBelow >= spaceAbove ? 'bottom' : 'top';

    // Horizontal auto-flip — left edge to the trigger when there is room,
    // otherwise the right edge — keeping the tooltip inside the viewport and
    // the transform-origin on the corner closest to the trigger.
    const spaceRight = vw - rect.left - VIEWPORT_PAD;
    const align: 'start' | 'end' = spaceRight >= tipW + GAP ? 'start' : 'end';

    let top = side === 'bottom' ? rect.bottom + GAP : rect.top - GAP;
    let left = align === 'start' ? rect.left : rect.right;

    // Final viewport clamp on both axes.
    if (side === 'bottom') {
      const maxTop = vh - VIEWPORT_PAD - tipH;
      if (top > maxTop) top = Math.max(VIEWPORT_PAD, maxTop);
    } else {
      const minTop = VIEWPORT_PAD + tipH;
      if (top < minTop) top = Math.min(vh - VIEWPORT_PAD, minTop);
    }
    if (align === 'start') {
      const maxLeft = vw - VIEWPORT_PAD - tipW;
      if (left > maxLeft) left = Math.max(VIEWPORT_PAD, maxLeft);
    } else {
      const minLeft = VIEWPORT_PAD + tipW;
      if (left < minLeft) left = Math.min(vw - VIEWPORT_PAD, minLeft);
    }

    setPos({ top, left, side, align });
  }, [open, maxWidth]);

  // First measurement before paint — never at (-9999, -9999).
  useLayoutEffect(() => {
    if (open) calcPos();
    else setPos(null);
  }, [open, calcPos]);

  // Second pass once the tooltip is in the DOM with real dimensions.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => calcPos());
    return () => cancelAnimationFrame(id);
  }, [open, calcPos]);

  // Close on scroll/resize so the tooltip never floats out of place.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const transformOrigin = pos
    ? `${pos.side === 'top' ? 'bottom' : 'top'} ${pos.align === 'end' ? 'right' : 'left'}`
    : undefined;

  return (
    <>
      <span
        ref={triggerRef}
        className={`kvl-hint relative inline-flex ${className}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        // Keyboard focus only (:focus-visible): a programmatic focus (opening a
        // window, restoring focus) must not open the help.
        onFocus={(e) => { if ((e.target as HTMLElement).matches?.(':focus-visible')) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          tabIndex={0}
          role="button"
          aria-label={t('info.more')}
          className={`inline-flex items-center text-zinc-400 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-help outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded-full`}
        >
          <Info size={size} strokeWidth={1.75} />
        </span>
      </span>
      {open && createPortal(
        <div className={isDark ? 'dark' : ''}>
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos?.side === 'bottom' ? pos.top : undefined,
              bottom: pos?.side === 'top' ? window.innerHeight - (pos?.top ?? 0) : undefined,
              left: pos?.align === 'start' ? pos.left : undefined,
              right: pos?.align === 'end' ? window.innerWidth - (pos?.left ?? 0) : undefined,
              maxWidth,
              transformOrigin,
              zIndex: 2147483647,
              pointerEvents: 'none',
              // The tooltip is portaled out of the React tree, so inheritance
              // does not reach it. Pin the stack here; var(--kvl-font-sans) is
              // defined in theme.css :root and in the shadow host :host rule.
              fontFamily: 'var(--kvl-font-sans)',
              opacity: pos ? 1 : 0,
              transition: 'opacity 100ms ease',
            }}
            className={`${pos?.side === 'top' ? 'sl-animate-info-tip-up' : 'sl-animate-info-tip'} w-max px-3 py-2 rounded-lg ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] bg-white dark:bg-zinc-900 shadow-[0_12px_32px_-8px_rgba(0,0,0,.25)] text-[12px] leading-[1.45] font-normal normal-case tracking-normal text-zinc-600 dark:text-zinc-300 whitespace-normal`}
          >
            {text}
          </span>
        </div>,
        container,
      )}
    </>
  );
}