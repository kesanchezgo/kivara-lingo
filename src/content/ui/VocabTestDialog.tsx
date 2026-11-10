/**
 * Vocabulary check in a centred window (docs/REDESIGN-V2.md §3 H1, §5.3;
 * ported from the prototype, WITHOUT Radix Dialog).
 *
 * Radix's Dialog is a FocusScope plus a DismissableLayer: both read
 * `document.activeElement` and listen on `document`, and inside our CLOSED
 * shadow root those only ever see the host. The dialog therefore builds its
 * own trap on the repo's shadow-root registry: the focused node is read with
 * `getShadowRoot(host).activeElement` (the only way to see inside a closed
 * root from page-level code), Tab wraps inside the window, Escape closes only
 * the window and focus returns to whatever opened it.
 *
 * Behaviour kept from the prototype:
 *  · A click outside closes only while nothing is marked; with progress, only
 *    Cancel, ✕ or Escape close it (a half-done check is not lost by accident).
 *  · The focus goes to the window on open (not to the first control), so Tab
 *    enters the controls in order.
 *  · The header shows the step and a progress bar drawn like the level ladder.
 *  · On save, a toast with the recalculated level; the tab behind is updated.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Timer, X } from '../../ui/icons';
import { t, fmtNumber } from '../../shared/i18n';
import { getShadowRoot } from '../shadow-host';
import { IconButton, IconTile, tx } from '../../ui/primitives/settings-primitives';
import { VocabCheck, VC_ITEMS_PER_ATTEMPT, type VcStep } from './VocabCheck';
import type { VcChecks, VocabBank } from '../../shared/study/vocabCheck';
import type { Estimator } from '../../shared/study/wordStatus';

/**
 * The focused element, through the closed root when there is one: the page
 * sees only the shadow host as `document.activeElement`, so the host is looked
 * up in the registry and its `activeElement` is the real answer.
 */
function deepActiveElement(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const root = getShadowRoot(active);
  if (root?.activeElement instanceof HTMLElement) return root.activeElement;
  return active;
}

/** Same resolution for a node: its root's active element (shadow) or the document's. */
function activeWithin(node: Node | null): HTMLElement | null {
  const root = node?.getRootNode();
  if (root instanceof ShadowRoot) {
    const shadowActive = getShadowRoot(root.host as HTMLElement)?.activeElement;
    if (shadowActive instanceof HTMLElement) return shadowActive;
  }
  return document.activeElement as HTMLElement | null;
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export interface VocabTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: VocabBank;
  l1: string;
  langName: string;
  before: Estimator;
  preview(test: { answers: string[]; checks?: VcChecks; shown: string[] }): Estimator;
  onSave(answers: string[], checks: VcChecks, shown: string[]): void;
}

export function VocabTestDialog({
  open, onOpenChange, bank, l1, langName, before, preview, onSave,
}: VocabTestDialogProps) {
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<{ step: VcStep; total: number }>({ step: 'mark', total: 2 });
  const contentRef = useRef<HTMLDivElement>(null);
  /** Who had focus when the window opened (before this component moves it). */
  const returnTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    returnTo.current = deepActiveElement();
    setProgress(0);
    setStep({ step: 'mark', total: 2 });
    contentRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Return focus on close (Escape, ✕, Cancel, outside click or save).
  useEffect(() => {
    if (!open) return;
    const target = returnTo.current;
    return () => {
      returnTo.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open]);

  // While open, the page behind must not scroll under the window.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (!open) return null;

  const segments = step.total === 2 ? ['mark', 'check', 'result'] : ['mark', 'result'];
  const current = segments.indexOf(step.step);
  const stepText = step.step === 'result'
    ? t('vc.resultStep')
    : step.total === 2
      ? `${t('vc.stepOf', { n: step.step === 'mark' ? 1 : 2, total: 2 })} · ${t(step.step === 'mark' ? 'vc.stepMark' : 'vc.stepCheck')}`
      : t('vc.stepMark');

  const close = () => onOpenChange(false);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables(contentRef.current);
    if (!list.length) {
      e.preventDefault();
      return;
    }
    const active = activeWithin(contentRef.current);
    const index = active ? list.indexOf(active) : -1;
    const nextIndex = e.shiftKey
      ? (index <= 0 ? list.length - 1 : index - 1)
      : (index < 0 || index === list.length - 1 ? 0 : index + 1);
    e.preventDefault();
    list[nextIndex]?.focus();
  };

  return (
    <div data-vocab-backdrop className="fixed inset-0 z-[70] kvl-ui">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-zinc-950/45 dark:bg-black/60 backdrop-blur-[2px]"
        onMouseDown={() => { if (progress === 0) close(); }}
      />
      <div className="absolute inset-0 grid place-items-center p-4 sm:p-6 pointer-events-none">
        <div
          ref={contentRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="kivara-vocab-title"
          aria-describedby="kivara-vocab-subtitle"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="pointer-events-auto w-full max-w-[600px] max-h-[min(760px,calc(100vh-48px))] flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] shadow-[0_24px_64px_-16px_rgba(0,0,0,.45)] text-zinc-900 dark:text-zinc-100 outline-none"
        >
          <header className="shrink-0 px-5 pt-4 pb-3.5 border-b border-zinc-900/[0.06] dark:border-white/[0.06] space-y-3.5">
            <div className="flex items-center gap-3">
              <IconTile className="!w-9 !h-9 !rounded-xl [&>svg]:!size-[18px]"><Timer /></IconTile>
              <div className="flex-1 min-w-0">
                <h2 id="kivara-vocab-title" className={tx.title}>{t('vc.title')}</h2>
                <p id="kivara-vocab-subtitle" data-vocab-steptext className={`${tx.small} mt-0.5 truncate`}>
                  {stepText}
                  <span className="text-zinc-400 dark:text-zinc-400">
                    {' · '}{t('vt.subtitle', { lang: langName, n: fmtNumber(VC_ITEMS_PER_ATTEMPT) })}
                  </span>
                </p>
              </div>
              <IconButton aria-label={t('common.close')} title={t('common.close')} className="-mr-1.5 self-start" onClick={close}>
                <X size={16} />
              </IconButton>
            </div>
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
              aria-hidden="true"
              data-vocab-progress={current}
            >
              {segments.map((segment, i) => (
                <span key={segment} className="h-1 rounded-full overflow-hidden bg-zinc-900/[0.07] dark:bg-white/[0.08]">
                  <span className={`block h-full rounded-full bg-indigo-500 dark:bg-indigo-400 transition-[width] duration-300 ${i <= current ? 'w-full' : 'w-0'}`} />
                </span>
              ))}
            </div>
          </header>
          <VocabCheck
            layout="dialog"
            bank={bank}
            l1={l1}
            langName={langName}
            before={before}
            preview={preview}
            onProgress={setProgress}
            onStep={(s, total) => setStep({ step: s, total })}
            onCancel={close}
            onSave={onSave}
            onDone={(est) => {
              close();
              toast.success(t('vt.savedTitle'), {
                description: t('vt.savedBody', {
                  lang: langName, level: est.level, name: t(`ws.level.${est.level}`), n: fmtNumber(est.total),
                }),
                duration: 3600,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}