/**
 * Capture overlay (ported from the prototype, docs/REDESIGN-V2.md §5.1).
 *
 * It draws the two visible moments of a card save:
 *  - the shutter flash, when the frame is taken;
 *  - the audio pill, while the line is being recorded, saying where the audio
 *    comes from (the line that is playing, or a repeat of it), how it is cut
 *    (voice detection or the cue), and whether the scene was captured.
 *
 * View only: the state is driven by App's real save path
 * (`captureBestFrame` + `ensureSubtitleAudioReady`), not by a simulated clock.
 * The card theme is shared with the word card.
 */
import { AudioLines, Camera, Check, X } from '../../ui/icons';
import { t } from '../../shared/i18n';
import type { EndDetect } from '../../shared/types';

/** Where the audio comes from: the tab buffer, the line playing, or a repeat. */
export type CaptureAudio = 'memory' | 'live' | 'replay' | 'off';

/** What CaptureOverlay draws. */
export interface CaptureView {
  /** Shutter flash: the scene is being taken now. */
  flash: boolean;
  /** Audio in progress; null before/after it (or with no audio). */
  audio: CaptureAudio | null;
  frame: 'pending' | 'ok' | 'failed';
  mode: EndDetect;
}

const BARS = [0.5, 1, 0.7, 0.4, 0.85, 0.6, 0.9, 0.5];

export function CaptureOverlay({
  view,
  cardTheme = 'dark',
}: {
  view: CaptureView | null;
  cardTheme?: 'dark' | 'light' | 'auto';
}) {
  if (!view) return null;
  const showPill = view.audio !== null && view.audio !== 'off';
  return (
    <>
      <div
        className={`absolute inset-0 z-40 pointer-events-none transition-[background-color] duration-500 ease-out ${
          view.flash ? 'animate-[kvl-shutter_260ms_ease-out]' : showPill ? 'bg-zinc-950/35' : ''
        }`}
      />
      {showPill && (
        <div
          className={`kvl-ui ${cardTheme === 'auto' ? '' : cardTheme} absolute inset-x-0 top-5 z-50 flex justify-center pointer-events-none`}
        >
          <div
            role="status"
            aria-live="polite"
            className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] rounded-xl pl-3 pr-4 py-2.5 flex items-center gap-3 shadow-[0_12px_32px_-8px_rgba(0,0,0,.45)]"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] flex items-center justify-center shrink-0">
              <AudioLines size={16} className="text-indigo-600 dark:text-indigo-300" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-900 dark:text-white text-[13px] font-semibold">
                  {view.audio === 'replay' ? t('overlay.replayLine') : t('overlay.captureAudio')}
                </span>
                <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-300 bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] h-5 inline-flex items-center px-1.5 rounded-md">
                  {view.mode === 'vad' ? t('set.vadLabel') : t('set.cueExact')}
                </span>
              </div>
              <div aria-hidden="true" className="flex gap-[3px] items-end h-3">
                {BARS.map((h, i) => (
                  <span
                    key={i}
                    className="w-[2px] bg-indigo-500 dark:bg-indigo-400 rounded-full animate-pulse"
                    style={{
                      height: `${h * 12}px`,
                      animationDuration: `${0.9 + (i % 3) * 0.15}s`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-zinc-500 dark:text-zinc-400 ml-1 pl-3 border-l border-zinc-900/[0.08] dark:border-white/[0.08] self-stretch">
              {view.frame === 'failed' ? (
                <>
                  <Camera size={13} className="text-rose-500 dark:text-rose-400" />
                  <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                    {t('overlay.frameFailed')} <X size={11} weight="bold" />
                  </span>
                </>
              ) : (
                <>
                  <Camera size={13} className={view.frame === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-50'} />
                  <span className={`inline-flex items-center gap-1 ${view.frame === 'ok' ? '' : 'opacity-50'}`}>
                    {t('overlay.frameDone')} {view.frame === 'ok' && <Check size={11} weight="bold" />}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}