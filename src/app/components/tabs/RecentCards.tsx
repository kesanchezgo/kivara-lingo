import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, Check, ChevronDown, Clock, Eye, FilmSlate, History, Loader2, RefreshCw, Undo2, Volume2, X,
} from '../../../ui/icons';
import { sendMessage } from 'webext-bridge/content-script';
import { t } from '../../../shared/i18n';
import type {
  AnkiBrowseResponse,
  AnkiDeleteNoteResponse,
  CardDismissResponse,
  CardRetryAllResponse,
  CardRetryResponse,
} from '../../../shared/types';
import { MAX_CARD_RETRIES, hasAudio, hasFrame, isPending, type CardStatus, type RecentCard } from '../../../shared/cards';
import { CARD_ERROR_LABEL_KEYS, classifyCardError } from '../../../shared/card-errors';
import { originLabel, tagsOf } from '../../../shared/study/cardTags';
import {
  Badge, Button, FilterChips, IconButton, IconTile, SectionLabel, ui, FOCUS,
} from '../../../ui/primitives/settings-primitives';

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

/** Newest-first page size; "Show all" reveals the rest. */
const PAGE = 5;

/** A card with the optional context count some builds attach to the registry
 * entry. The engine does not write it today; the row supports it when present. */
type RecentRowCard = RecentCard & { contexts?: number };

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

/**
 * Legacy fallback: rows written before `errorCode` existed carry only the raw
 * provider sentence. Classify it with the SAME function the worker uses, then
 * read the SAME label table — one source of truth, so an old row and a new one
 * name a failure identically. New rows never reach this.
 */
function shortError(error?: string): string {
  if (!error) return '';
  return t(CARD_ERROR_LABEL_KEYS[classifyCardError(error)]);
}

/** What a saved card is missing (old cards without a media record count as
 * complete). */
function missingMedia(card: RecentCard): string {
  if (!card.media) return '';
  const noWord = card.media.word === false;
  const audio = !card.media.audio && noWord
    ? t('recent.mAudioAll')
    : !card.media.audio
      ? t('recent.mAudio')
      : noWord ? t('recent.mWord') : '';
  const items = [!card.media.frame && t('recent.mFrame'), audio].filter(Boolean);
  return items.length ? t('recent.missing', { items: items.join(t('recent.missingJoin')) }) : '';
}

/** Same clock for the whole list: 1 s countdowns, 30 s otherwise. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function RecentRow({
  card,
  now,
  emphasize,
  showLang,
  onChanged,
}: {
  card: RecentRowCard;
  now: number;
  emphasize: boolean;
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

  const seeInAnki = () => run(async () => {
    if (card.noteId == null) return false;
    const res = (await sendMessage('ANKI_BROWSE', { noteId: card.noteId }, 'background')) as AnkiBrowseResponse;
    return !!res?.ok;
  }, t('wp.openedInAnki'), t('wp.openInAnkiFailed'));

  const undo = () => run(async () => {
    if (card.noteId == null) return false;
    const res = (await sendMessage('ANKI_DELETE_NOTE', { noteId: card.noteId }, 'background')) as AnkiDeleteNoteResponse;
    return !!res?.ok;
  }, t('queue.undone'), t('queue.undoFailed'));

  const retry = () => run(async () => {
    const res = (await sendMessage('CARD_RETRY', { id: card.id }, 'background')) as CardRetryResponse;
    // A permanent failure left no pending row to restore the blobs from: the
    // retry saved the card, but without the scene/original audio. Say so.
    if (res?.mediaLost) toast.warning(t('recent.mediaLost'));
    if (!res?.ok) toast.error(t('queue.willRetry'), { description: res?.error });
    return !!res?.ok;
  }, t('queue.autoSentOne'), t('recent.failed'));

  const dismiss = () => run(async () => {
    const res = (await sendMessage('CARD_DISMISS', { id: card.id }, 'background')) as CardDismissResponse;
    return !!res?.ok;
  }, t('queue.discarded'), t('queue.undoFailed'));

  const nCtx = card.contexts ?? 0;
  const origin = [
    originLabel(card.source) ?? card.deck,
    nCtx ? (nCtx === 1 ? t('recent.moreContextsOne') : t('recent.moreContexts', { n: nCtx })) : '',
  ].filter(Boolean).join(' · ');
  // Every CreateCardKind has a label: a `cloze` card used to show none, and
  // adding a kind meant hunting this condition. `recent.kind.*` is the one
  // template family the dead-key scan allows, and a test walks the whole
  // union so a new kind without copy fails CI.
  const kindLabel = t(`recent.kind.${card.kind}`);
  // The CODE wins: it is what the worker classified at the failure, and the
  // dictionary owns the sentence. `shortError` remains for rows written before
  // codes existed (and for a row whose code has no label, which cannot happen
  // without failing the label test).
  const errLabel = card.errorCode
    ? t(CARD_ERROR_LABEL_KEYS[card.errorCode])
    : card.error ? shortError(card.error) : '';
  const meta =
    card.status === 'saved'
      ? `${origin} · ${relativeAgo(card.savedAt ?? card.createdAt, now)}`
      : card.status === 'sending'
        ? t('recent.sending')
        : card.status === 'queued'
          ? `${t('recent.retryIn', { time: fmtCountdown((card.nextRetryAt ?? now) - now) })} · ${t('recent.attempt', { n: card.attempts, max: MAX_CARD_RETRIES })}`
          : `${t('recent.failed')} · ${errLabel}`;
  // Next to the kind, not at the end of the details (where "Undo" would clip
  // it): the gap is always visible.
  const missing = missingMedia(card);
  const undoHidden = emphasize || busy
    ? ''
    : 'opacity-0 group-hover/r:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100';
  const title = card.error
    ? card.error
    : [originLabel(card.source), card.deck, t(`lang.${card.lang}`), tagsOf(card).join(' ')].filter(Boolean).join(' · ');

  return (
    <li className="group/r flex items-center gap-3 pl-3.5 pr-2 min-h-[52px] py-2">
      <StatusTile status={busy && card.status === 'saved' ? 'sending' : card.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span
            className="text-[13px] leading-[18px] font-medium text-zinc-800 dark:text-zinc-100 truncate shrink-0 max-w-[60%]"
            title={card.word}
          >
            {card.word}
          </span>
          {kindLabel && (
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 shrink-0">
              {kindLabel}
            </span>
          )}
          {missing && (
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400/90 truncate min-w-0" title={missing}>
              · {missing}
            </span>
          )}
          {showLang && (
            <Badge className="!h-4 !px-1 uppercase tracking-wide self-center" title={t(`lang.${card.lang}`)}>
              {card.lang}
            </Badge>
          )}
        </div>
        <div
          className={`text-[12px] leading-4 truncate tabular-nums ${card.status === 'failed'
            ? 'text-rose-600 dark:text-rose-400'
            : card.status === 'queued'
              ? 'text-amber-700 dark:text-amber-400/90'
              : 'text-zinc-500 dark:text-zinc-400'}`}
          title={title}
          data-card-tags={tagsOf(card).join(' ')}
        >
          {meta}
        </div>
      </div>
      {card.status === 'saved' && (
        <span className="flex items-center gap-0.5 shrink-0">
          <span className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
            {hasFrame(card) && (
              <span role="img" aria-label={t('recent.mFrame')} title={t('recent.mFrame')}>
                <FilmSlate size={13} />
              </span>
            )}
            {hasAudio(card) && (
              <span role="img" aria-label={t('recent.mAudioAll')} title={t('recent.mAudioAll')}>
                <Volume2 size={13} />
              </span>
            )}
          </span>
          <IconButton
            size="sm"
            aria-label={t('wp.seeInAnki')}
            title={t('wp.seeInAnki')}
            disabled={busy}
            onClick={() => void seeInAnki()}
          >
            <Eye size={13} />
          </IconButton>
          <Button
            size="sm"
            variant="ghost"
            icon={<Undo2 size={14} />}
            disabled={busy}
            onClick={() => void undo()}
            title={t('recent.undoTitle')}
            className={undoHidden}
          >
            {t('recent.undo')}
          </Button>
        </span>
      )}
      {(card.status === 'queued' || card.status === 'failed') && (
        <span className="flex items-center gap-0.5 shrink-0">
          <IconButton
            aria-label={t('recent.retry')}
            title={t('recent.retry')}
            disabled={busy}
            onClick={() => void retry()}
          >
            <RefreshCw size={14} />
          </IconButton>
          <IconButton
            aria-label={t('recent.discard')}
            title={t('recent.discard')}
            disabled={busy}
            onClick={() => void dismiss()}
          >
            <X size={14} />
          </IconButton>
        </span>
      )}
    </li>
  );
}

export function RecentCards({ onChanged }: { onChanged?: () => void } = {}) {
  const cards = useRecentCards();
  const pending = cards.filter(isPending);
  const [filter, setFilter] = useState<'all' | 'queue'>('all');
  const [expanded, setExpanded] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const hasQueued = pending.some((card) => card.status === 'queued');
  const now = useNow(hasQueued ? 1000 : 30_000);

  // No pending cards → there is no filter to show: back to "All".
  useEffect(() => {
    if (!pending.length && filter === 'queue') setFilter('all');
  }, [pending.length, filter]);

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

  // Pending first (the only thing that asks for attention), then sent.
  const ordered = filter === 'queue' ? pending : [...pending, ...cards.filter((card) => !isPending(card))];
  const visible = expanded ? ordered : ordered.slice(0, PAGE);
  // "Undo" always visible on the latest saved card (10 min); older ones on hover.
  const latestSavedId = cards.find((card) => card.status === 'saved')?.id;
  const multiLang = new Set(cards.map((card) => card.lang)).size > 1;
  const fresh = (card: RecentCard) => card.id === latestSavedId
    || (card.status === 'saved' && now - (card.savedAt ?? card.createdAt) < 10 * 60_000);

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
            {pending.length > 0 && (
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-zinc-900/[0.06] dark:border-white/[0.06]">
                {/* Filters the list: chips, like the transcript (the segmented
                    control is reserved for choosing values). */}
                <FilterChips
                  ariaLabel={t('recent.title')}
                  options={[
                    { v: 'all', l: t('recent.filterAll'), count: cards.length },
                    { v: 'queue', l: t('recent.filterQueue'), count: pending.length, icon: <Clock size={12} weight="bold" className="text-amber-600 dark:text-amber-400" /> },
                  ]}
                  value={filter}
                  onChange={setFilter}
                />
                <Button size="sm" variant="soft" icon={<RefreshCw size={14} />} disabled={busyAll} onClick={() => void retryAll()}>
                  {t('recent.retryAll')}
                </Button>
              </div>
            )}
            <ul className="divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
              {visible.map((card) => (
                <RecentRow
                  key={card.id}
                  card={card}
                  now={now}
                  emphasize={fresh(card)}
                  showLang={multiLang}
                  onChanged={() => onChanged?.()}
                />
              ))}
            </ul>
            {ordered.length > PAGE && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className={`w-full flex items-center justify-center gap-1.5 h-10 border-t border-zinc-900/[0.06] dark:border-white/[0.06] text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 ${ui.rowHover} ${FOCUS}`}
              >
                {expanded ? t('recent.showLess') : t('recent.showAll', { n: ordered.length })}
                <ChevronDown size={14} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
