import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface InfoHintProps {
  /** Texto o nodo a mostrar dentro del tooltip. */
  text: React.ReactNode;
  /** Tamaño del icono en px. Default: 10. */
  size?: number;
  /** Ancho máximo del tooltip. Default: 240. */
  maxWidth?: number;
  /** Clase adicional para el wrapper del icono. */
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
 * Tooltip with portal — works in popup/options/onboarding (regular DOM) AND
 * inside the content script's shadow root.
 *
 * **Shadow DOM strategy**: when the trigger lives inside a `ShadowRoot`, we
 * portal the tooltip directly into the **shadow root itself** (as a sibling
 * of the React root div). That guarantees:
 *   - The shadow's `<style>` sheet styles the tooltip (utilities + theme).
 *   - The tooltip escapes any `overflow: hidden` on a parent accordion.
 *   - React doesn't fight with us over the portal subtree (since it's not
 *     the same node React is rendering the tree into).
 *
 * In a normal document we portal into `document.body` like a regular tooltip.
 */
export function InfoHint({ text, size = 10, maxWidth = 240, className = '' }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<ResolvedPos | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | DocumentFragment | null>(null);
  const [isDark, setIsDark] = useState(false);

  // Resolve the portal target after the component mounts. Doing it in an
  // effect (not on first render) means `triggerRef.current` is guaranteed
  // to be a real DOM node — `getRootNode()` then tells us whether we're
  // inside a shadow tree or the main document.
  useEffect(() => {
    if (!triggerRef.current) return;
    const root = triggerRef.current.getRootNode();
    if (root instanceof ShadowRoot) {
      // Portal directly into the shadow root. ShadowRoot extends
      // DocumentFragment, which `createPortal` accepts. Inside the shadow
      // the host's `<style>` sheet still styles us.
      setPortalTarget(root);
    } else {
      setPortalTarget(document.body);
    }
  }, []);

  const calcPos = useCallback(() => {
    if (!open || !triggerRef.current) {
      return;
    }
    const triggerEl = triggerRef.current;
    const rect = triggerEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setIsDark(!!triggerEl.closest('.dark'));

    const tipEl = tipRef.current;
    const tipW = (tipEl?.offsetWidth ?? 0) || Math.min(maxWidth, 220);
    const tipH = (tipEl?.offsetHeight ?? 0) || 48;

    const spaceBelow = vh - rect.bottom - VIEWPORT_PAD;
    const spaceAbove = rect.top - VIEWPORT_PAD;
    const side: 'top' | 'bottom' =
      spaceBelow >= tipH + GAP ? 'bottom'
      : spaceAbove >= tipH + GAP ? 'top'
      : spaceBelow >= spaceAbove ? 'bottom' : 'top';

    // Horizontal auto-flip — anchor the tooltip's LEFT edge to the
    // trigger's left when there's room to its right; otherwise anchor
    // the tooltip's RIGHT edge to the trigger's right. This keeps the
    // tooltip inside the viewport AND keeps `transform-origin` on the
    // visually correct corner so the pop-in animation feels right
    // (matches the mock behavior).
    const spaceRight = vw - rect.left - VIEWPORT_PAD;
    const align: 'start' | 'end' = spaceRight >= tipW + GAP ? 'start' : 'end';

    let top = side === 'bottom' ? rect.bottom + GAP : rect.top - tipH - GAP;
    // `left` carries the meaningful x coordinate regardless of `align`:
    //  - align === 'start'  → tooltip's LEFT edge is at trigger.left
    //  - align === 'end'    → tooltip's RIGHT edge is at trigger.right
    let left = align === 'start' ? rect.left : rect.right;

    // Final viewport clamp on both axes.
    if (align === 'start') {
      const maxLeft = vw - VIEWPORT_PAD - tipW;
      if (left > maxLeft) left = Math.max(VIEWPORT_PAD, maxLeft);
    } else {
      const minLeft = VIEWPORT_PAD + tipW;
      if (left < minLeft) left = Math.min(vw - VIEWPORT_PAD, minLeft);
    }
    top = Math.max(VIEWPORT_PAD, Math.min(top, vh - VIEWPORT_PAD - tipH));

    setPos({ top, left, side, align });
  }, [open, maxWidth]);

  // First measurement pass — runs before browser paint so the user never
  // sees the tooltip at (-9999, -9999).
  useLayoutEffect(() => {
    if (open) calcPos();
    else setPos(null);
  }, [open, calcPos]);

  // Second measurement pass — once the tooltip is actually in the DOM and
  // has real dimensions, recalc to get pixel-perfect placement.
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

  return (
    <>
      <span
        ref={triggerRef}
        className={`relative inline-flex ${className}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          tabIndex={0}
          role="button"
          aria-label="Más información"
          className="inline-flex items-center text-zinc-400 dark:text-zinc-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors cursor-help outline-none focus-visible:text-indigo-500 dark:focus-visible:text-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/30 rounded-full"
        >
          <Info size={size} strokeWidth={2.25} />
        </span>
      </span>
      {open && portalTarget && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          className={isDark ? 'dark' : ''}
          style={{
            position: 'fixed',
            // Anchor by left edge or right edge depending on horizontal
            // auto-flip. When `align === 'end'` we pin the tooltip's right
            // edge to `vw - pos.left` so the tooltip stays inside the
            // viewport even on tight RHS placements.
            top: pos ? pos.top : -9999,
            left: pos && pos.align === 'start' ? pos.left : undefined,
            right: pos && pos.align === 'end' ? window.innerWidth - pos.left : undefined,
            // Make the in/out pop animation originate from the corner of the
            // tooltip closest to the trigger — matches the mock.
            transformOrigin: pos
              ? `${pos.side === 'top' ? 'bottom' : 'top'} ${pos.align === 'end' ? 'right' : 'left'}`
              : undefined,
            maxWidth,
            zIndex: 2147483647,
            pointerEvents: 'none',
            opacity: pos ? 1 : 0,
            transition: 'opacity 100ms ease',
            // The tooltip is portaled OUT of the React tree — directly into
            // either document.body (popup/options/onboarding) or the
            // ShadowRoot (content script). In both cases the host element's
            // font stack doesn't reliably reach us via inheritance, so we
            // pin the typography here to keep the tooltip text identical
            // to the rest of the panel. --kvl-font-sans is defined in
            // theme.css :root and shadow-host.ts :host, so it resolves the
            // same value in either context.
            fontFamily: 'var(--kvl-font-sans)',
            fontSize: 10.5,
            lineHeight: 1.35,
            letterSpacing: 'normal',
          }}
        >
          <div
            className={`${pos?.side === 'top' ? 'sl-animate-info-tip-up' : 'sl-animate-info-tip'} px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg shadow-zinc-900/15 dark:shadow-black/50 text-[10.5px] leading-snug font-normal normal-case tracking-normal text-zinc-700 dark:text-zinc-200 whitespace-normal`}
          >
            {text}
          </div>
        </div>,
        portalTarget,
      )}
    </>
  );
}
