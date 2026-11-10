import { useEffect, useState } from 'react';
import { AlertCircle, Check, Clock, History, Loader2 } from '../../../ui/icons';
import { t } from '../../../shared/i18n';
import type { CardStatus, RecentCard } from '../../../ui/ports/types';
import { IconTile, SectionLabel, ui } from './settings-primitives';

/**
 * Recent cards + retry queue.
 *
 * F4 owns the writer: the service worker keeps the single card registry and
 * publishes the last 50 (without media) under `kvl:cards.recent` in
 * chrome.storage.local, per docs/REDESIGN-V2.md H10. This component is the
 * thin reader — it never owns state and never mutates the queue, so there is
 * exactly one writer. Until F4 lands that key has no producer and the section
 * renders its empty state; the record shape is `RecentCard` from
 * `src/ui/ports/types.ts`, the same one F4 fills.
 */
export const RECENT_CARDS_KEY = 'kvl:cards.recent';

export function isPending(card: RecentCard): boolean {
  return card.status === 'queued' || card.status === 'failed' || card.status === 'sending';
}

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

/** Subscribe to the SW-published registry (F4). */
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

export function RecentCards() {
  const cards = useRecentCards();
  const pending = cards.filter(isPending);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const ordered = [...pending, ...cards.filter((c) => !isPending(c))];

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
          <ul className="divide-y divide-zinc-900/[0.06] dark:divide-white/[0.06]">
            {ordered.map((card) => {
              const meta =
                card.status === 'saved'
                  ? `${card.deck}${card.deck ? ' · ' : ''}${relativeAgo(card.createdAt, now)}`
                  : card.status === 'sending'
                    ? t('recent.sending')
                    : t('recent.failed');
              const kindLabel = card.kind === 'word' || card.kind === 'expression'
                ? t(`recent.kind.${card.kind}`)
                : null;
              return (
                <li key={card.id} className="kvl-row flex items-center gap-3 pl-3.5 pr-3 min-h-[52px] py-2">
                  <StatusTile status={card.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span
                        className="text-[13px] leading-[18px] font-medium text-zinc-800 dark:text-zinc-100 truncate"
                        title={card.word}
                      >
                        {card.word}
                      </span>
                      {kindLabel && (
                        <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 shrink-0">
                          {kindLabel}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}