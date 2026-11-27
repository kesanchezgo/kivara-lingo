/**
 * PR #171 — Netflix's contextual buttons, in Kivara's clothes.
 *
 * `Saltar intro`, `Saltar resumen`, the pre-play button and the seamless
 * next-episode button are hidden by the owned bar's sheet (they live in the
 * chrome we replace). Hiding them without replacing them would take a feature
 * away from the user, so this watches for their presence — Netflix mounts and
 * removes them by itself — and re-renders a Kivara pill over the bottom tray
 * that forwards the click to the real node.
 */
import { useEffect, useState } from 'react';
import { t } from '../../shared/i18n';
import { wakeNativeRow } from './cleanup-css';
import { resolvePlayerRoot } from './native-bar-slot';

/** In priority order: the first one present is the one worth showing. */
const SKIP_SELECTORS = [
  '[data-uia="player-skip-intro"]',
  '[data-uia="player-skip-recap"]',
  '[data-uia="player-skip-preplay"]',
  '[data-uia="next-episode-seamless-button"]',
  '[data-uia="next-episode-seamless-button-draining"]',
] as const;

export interface PlayerSkipPromptProps {
  /** A clean capture is running: nothing of ours may be in the frame. */
  capturing?: boolean;
  /**
   * Whether the bottom tray is on screen. NOT a visibility gate: the intro
   * (and the recap) usually run with the pointer resting, when the tray has
   * auto-hidden — hiding the pill then would take the button away exactly
   * when the user needs it. It only decides where the pill sits.
   */
  visible: boolean;
  /** A native popup owns the pointer: no pill of ours over it. */
  popupOpen?: boolean;
  /** Effective chrome height (tray + its gap), 0 while the tray rests. */
  barHeightPx?: number;
}

export function PlayerSkipPrompt({
  capturing = false, visible, popupOpen = false, barHeightPx = 0,
}: PlayerSkipPromptProps) {
  const [target, setTarget] = useState<{ selector: string; label: string } | null>(null);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const resolve = () => {
      for (const selector of SKIP_SELECTORS) {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) continue;
        // The site's own words when it has them (localised by Netflix), a
        // translated fallback otherwise.
        const label = (el.textContent ?? '').trim()
          || (selector.includes('next-episode') ? t('player.nextEpisode') : t('player.skipIntro'));
        setTarget((current) => (current?.selector === selector && current.label === label ? current : { selector, label }));
        return;
      }
      setTarget(null);
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  // A capture takes a clean frame and a native popup deserves the pointer,
  // but the tray being at rest must NOT hide this: that is when the intro
  // (and the recap) actually play.
  if (!target || capturing || popupOpen) return null;

  return (
    <div
      className="absolute right-4 z-20 pointer-events-none transition-[bottom] duration-200"
      style={{ bottom: visible && barHeightPx > 0 ? `${barHeightPx + 12}px` : '24px' }}
    >
      <button
        type="button"
        data-kvl-skip-prompt=""
        onClick={() => {
          // The native node is in the chrome our sheet hides: wake the row
          // before clicking it, exactly like the tray does for CC/episodes.
          wakeNativeRow(resolvePlayerRoot('netflix', document.querySelector<HTMLVideoElement>('video')), null);
          document.querySelector<HTMLElement>(target.selector)?.click();
        }}
        className="pointer-events-auto h-9 px-3.5 rounded-xl bg-zinc-950/90 hover:bg-indigo-600 text-white text-[13px] font-medium ring-1 ring-white/[0.14] shadow-xl backdrop-blur-xl flex items-center gap-2 kvl-press outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
      >
        {target.label}
      </button>
    </div>
  );
}
