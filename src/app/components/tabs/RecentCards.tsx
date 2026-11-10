import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Check, Clock, Eye, History, Loader2, RefreshCw, Undo2, X } from '../../../ui/icons';
import { sendMessage } from 'webext-bridge/content-script';
import { t } from '../../../shared/i18n';
import type {
  AnkiBrowseResponse,
  AnkiDeleteNoteResponse,
  CardDismissResponse,
  CardRetryAllResponse,
  CardRetryResponse,
} from '../../../shared/types';
import { MAX_CARD_RETRIES, isPending, type CardStatus, type RecentCard } from '../../../shared/cards';
import { originLabel } from '../../../shared/study/cardTags';
import { IconTile, SectionLabel, ui } from '../../../ui/primitives/settings-primitives';

/**
 * Recent cards + retry queue (docs/REDESIGN-V2.md §3 H10, §7 F4).
 *
 * The service worker is the SINGLE writer of `kvl:cards.recent`: it publishes
 * the last 50 cards (no media) and every state transition. This component only
 * reads the key, subscribes with `onChanged`, and sends commands
 * (ANKI_DELETE_NOTE, ANKI_BROWSE, CARD_RETRY, CARD_RETRY_ALL, CARD_DISMISS).
 */
export const RECENT_CARDS_KEY = 'kvl:cards.recent';

export { isPending };

function readCards(value: unknown): RecentCard[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is RecentCard => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Partial<RecentCard>;
    return (
      typeof r.id === 'string'
      && typeof r.word === 'string'
      && typeof r.status === 'string'
    );
  });
}

/** Subscribe to the SW-published registry. */
export function useRecentCards(): RecentCard[] {
  const [cards, setCards] = useState<RecentCard[]>([]);
  useEffect(() => {
    let alive = true;
    try {
      chrome.storage.local.get(RECENT_CARDS_KEY, (res) => {
        if (!alive) return;
        setCards(readCards(res?.[RECENT_CARDS_KEY]));
      });
    } catch {
      // No chrome.storage (tests without a stub): stay empty.
    }
    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => {
      if (area !== 'local' || !(RECENT_CARDS_KEY in changes)) return;
      setCards(readCards(changes[RECENT_CARDS_KEY]?.newValue));
    };
    try {
      chrome.storage.onChanged.addListener(listener);
    } catch {
      // ignore
    }
    return () => {
      alive = false;
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch {
        // ignore
      }
    };
  }, []);
  return cards;
}

const TILE: Record<CardStatus, string> = {
  saved: 'bg-emerald-500/[0.08] dark:bg-emerald-400/[0.1] text-emerald-600 dark:text-emerald-300',
  sending: 'bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] text-indigo-600 dark:text-indigo-300',
  queued: 'bg-amber-500/[0.1] dark:bg-amber-400/[0.1] text-amber-600 dark:text-amber-300',
  failed: 'bg-rose-500/[0.08] dark:bg-rose-400/[0.1] text-rose-600 dark:text-rose-300',
};

function StatusTile({ status }: { status: CardStatus }) {
  return (
    <span aria-hidden="true" className={`w-7 h-7 rounded-lg shrink-0 inline-flex items-center justify-center ${TILE[status]}`}>
      {status === 'saved' && <Check size={14} weight="bold" />}
      {status === 'sending' && <Loader2 size={14} className="animate-spin" />}
      {status === 'queued' && <Clock size={14} weight="bold" />}
      {status === 'failed' && <AlertCircle size={14} weight="bold" />}
    </span>
  );
}

/** "5 minutes ago" without pulling date-fns into the panel. */
function relativeAgo(at: number, now: number): string {
  const diffMs = now - at;
  if (diffMs < 45_000) return t('recent.justNow');
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

function fmtCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

const ROW_ACTION =
  'inline-flex items-center gap-1 text-[11px] font-medium px-1.5 h-7 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function RecentRow({
  card,
  now,
  showLang,
  onChanged,
}: {
  card: RecentCard;
  now: number;
  showLang: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<boolean>, success: string, failure: string) => {
    setBusy(true);
    try {
      if (await action()) {
        toast.success(success);
        onChanged();
      } else {
        toast.error(failure);
      }
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const undo = () => run(async () => {
    if (card.noteId == null) return false;
    const res = (await sendMessage('ANKI_DELETE_NOTE', { noteId: card.noteId }, 'background')) as AnkiDeleteNoteResponse;
    return !!res?.ok;
  }, t('queue.undone'), t('queue.undoFailed'));

  const seeInAnki = () => run(async () => {
    if (card.noteId == null) return false;
    const res = (await sendMessage('ANKI_BROWSE', { noteId: card.noteId }, 'background')) as AnkiBrowseResponse;
    return !!res?.ok;
  }, t('wp.openedInAnki'), t('wp.openInAnkiFailed'));

  const retry = () => run(async () => {
    const res = (await sendMessage('CARD_RETRY', { id: card.id }, 'background')) as CardRetryResponse;
    if (!res?.ok) toast.error(t('queue.willRetry'), { description: res?.error });
    return !!res?.ok;
  }, t('queue.autoSentOne'), t('recent.failed'));

  const dismiss = () => run(async () => {
    const res = (await sendMessage('CARD_DISMISS', { id: card.id }, 'background')) as CardDismissResponse;
    return !!res?.ok;
  }, t('queue.discarded'), t('queue.undoFailed'));

  const origin = originLabel(card.source) ?? card.deck;
  const kindLabel = card.kind === 'word' || card.kind === 'expression'
    ? t(`recent.kind.${card.kind}`)
    : null;
  const meta =
    card.status === 'saved'
      ? `${origin}${origin ? ' · ' : ''}${relativeAgo(card.savedAt ?? card.createdAt, now)}`
      : card.status === 'sending'
        ? t('recent.sending')
        : card.status === 'queued'
          ? `${t('recent.retryIn', { time: fmtCountdown((card.nextRetryAt ?? now) - now) })} · ${t('recent.attempt', { n: card.attempts, max: MAX_CARD_RETRIES })}`
          : `${t('recent.failed')}${card.error ? ` · ${card.error}` : ''}`;

  return (
    <li className="kvl-row flex items-center gap-3 pl-3.5 pr-2 min-h-[52px] py-2">
      <StatusTile status={busy && card.status === 'saved' ? 'sending' : card.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span
            className="text-[13px] leading-[18px] font-medium text-zinc-800 dark:text-zinc-100 truncate"
            title={card.word}
          >
            {card.word}
          </span>
          {kindLabel && (
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-400 shrink-0">
              {kindLabel}
            </span>
          )}
          {showLang && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-400 shrink-0">
              {card.lang}
            </span>
          )}
        </div>
        <div
          className={`text-[12px] leading-4 truncate tabular-nums ${card.status === 'failed'
            ? 'text-rose-600 dark:text-rose-400'
            : card.status === 'queued'
              ? 'text-amber-700 dark:text-amber-400/90'
              : 'text-zinc-500 dark:text-zinc-400'}`}
          title={card.error ?? card.sentence}
        >
          {meta}
        </div>
      </div>
      {card.status === 'saved' ? (
        <span className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void seeInAnki()}
            disabled={busy}
            className={`${ROW_ACTION} text-zinc-500 dark:text-zinc-400 hover:text-emerald-700 dark:hover:text-emerald-300`}
            title={t('wp.seeInAnki')}
          >
            <Eye size={13} />
          </button>
          <button
            type="button"
            onClick={() => void undo()}
            disabled={busy}
            className={`${ROW_ACTION} text-zinc-500 dark:text-zinc-400 hover:text-rose-700 dark:hover:text-rose-300`}
            title={t('recent.undoTitle')}
          >
            <Undo2 size={13} />
            <span>{t('recent.undo')}</span>
          </button>
        </span>
      ) : card.status !== 'sending' ? (
        <span className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            className={`${ROW_ACTION} text-zinc-500 dark:text-zinc-400 hover:text-indigo-700 dark:hover:text-indigo-300`}
            title={t('recent.retry')}
          >
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={busy}
            className={`${ROW_ACTION} text-zinc-500 dark:text-zinc-400 hover:text-rose-700 dark:hover:text-rose-300`}
            title={t('recent.discard')}
          >
            <X size={13} />
          </button>
        </span>
      ) : null}
    </li>
  );
}

export function RecentCards({ onChanged }: { onChanged?: () => void } = {}) {
  const cards = useRecentCards();
  const pending = cards.filter(isPending);
  const [now, setNow] = useState(() => Date.now());
  const [busyAll, setBusyAll] = useState(false);
  const hasQueued = pending.some((c) => c.status === 'queued');
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), hasQueued ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [pending.length, hasQueued]);

  const retryAll = async () => {
    setBusyAll(true);
    try {
      const res = (await sendMessage('CARD_RETRY_ALL', {}, 'background')) as CardRetryAllResponse;
      const sent = res?.succeeded ?? 0;
      if (sent > 0) toast.success(sent === 1 ? t('queue.autoSentOne') : t('queue.autoSentMany', { n: sent }));
      onChanged?.();
    } finally {
      setBusyAll(false);
    }
  };

  const ordered = [...pending, ...cards.filter((card) => !isPending(card))];
  const multiLang = new Set(cards.map((card) => card.lang)).size > 1;

  return (
    <section>
      <SectionLabel
        hint={t('recent.hint')}
        right={pending.length > 0
          ? (
            <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {t('recent.queuedCount', { n: pending.length })}
            </span>
          )
          : cards.length > 0 ? <span className="tabular-nums">{cards.length}</span> : null}
      >
        {t('recent.title')}
      </SectionLabel>
      <div className={ui.card}>
        {cards.length === 0 ? (
          <div className="py-7 px-6 text-center flex flex-col items-center gap-2.5">
            <IconTile className="!w-8 !h-8"><History size={16} /></IconTile>
            <div className="space-y-1 max-w-[260px]">
              <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{t('recent.emptyTitle')}</p>
              <p className="text-[12px] leading-[17px] text-zinc-500 dark:text-zinc-400">{t('recent.emptyBody')}</p>
            </div>
          </div>
        ) : (
          <>
            {pending.length > 1 && (
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-zinc-900/[0.06] dark:border-white/[0.06]">
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  {t('recent.queuedCount', { n: pending.length })}
                </span>
                <button
                  type="button"
                  onClick={() => void retryAll()}
                  disabled={busyAll}
                  className={`${ROW_ACTION} text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10`}
                >
                  <RefreshCw size={12} />
                  {t('recent.retryAll')}
                </button>
              </div>
            )}
            <ul className="divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
              {ordered.map((card) => (
                <RecentRow
                  key={card.id}
                  card={card}
                  now={now}
                  showLang={multiLang}
                  onChanged={() => onChanged?.()}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}