import { toast } from 'sonner';
import { CheckCircle2, Undo2, X, AlertTriangle } from '../../ui/icons';
import { t } from '../../shared/i18n';
import type { AnkiPingErrorCode } from '../../shared/types';

/**
 * Card-queue notices shared by the overlay and the recent-cards list: same
 * copy and same "Undo" in both. View only — the queue owner and the undo call
 * land with F4; this component receives the undo action as a callback.
 */

/** Human-readable reason for an AnkiConnect failure (same copy as the popup). */
export function ankiReason(code?: AnkiPingErrorCode): string {
  if (code === 'API_KEY') return t('popup.anki.errApiKey');
  if (code === 'TIMEOUT') return t('popup.anki.errTimeout');
  return t('popup.anki.down');
}

/** The subset of a recent card this notice needs to render. */
export interface ToastCard {
  id: string;
  text: string;
  deck: string;
}

/**
 * "Card saved" with Undo (5 s, like the mail client's "Undo send").
 * `notes`: what is missing (frame, sentence audio or word audio); the card is
 * saved anyway, so the notice explains instead of blocking.
 */
export function showSavedToast(card: ToastCard, onUndo: (card: ToastCard) => void, notes: string[] = []) {
  toast.custom((id) => (
    <div className="kvl-ui w-[340px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl ring-1 ring-zinc-900/[0.08] dark:ring-white/[0.08] rounded-xl shadow-[0_12px_32px_-8px_rgba(0,0,0,.35)] pl-3 pr-1.5 py-2.5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-400/[0.12] text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0">
          <CheckCircle2 size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-zinc-900 dark:text-white leading-[18px]">{t('app.cardSaved')}</div>
          <div className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-4 truncate">
            <span className="font-medium text-indigo-600 dark:text-indigo-300">{card.text}</span>
            <span className="text-zinc-400 dark:text-zinc-500"> → </span>
            {card.deck}
          </div>
        </div>
        <button
          onClick={() => { toast.dismiss(id); onUndo(card); }}
          className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-900/[0.05] dark:bg-white/[0.07] hover:bg-zinc-900/[0.08] dark:hover:bg-white/[0.1] transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <Undo2 size={13} /> {t('recent.undo')}
        </button>
        <button
          onClick={() => toast.dismiss(id)}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-900/[0.05] dark:hover:bg-white/[0.06] transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <X size={13} />
        </button>
      </div>
      {notes.map((note) => (
        <p key={note} className="mt-1.5 ml-11 mr-2 text-[12px] leading-4 font-normal text-amber-700 dark:text-amber-400/90 flex items-start gap-1">
          <AlertTriangle size={12} className="shrink-0 mt-[2px]" />
          <span>{note}</span>
        </p>
      ))}
    </div>
  ), { duration: notes.length ? 7000 : 5000 });
}