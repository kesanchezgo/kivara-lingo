/**
 * Frequency badge for the word card (docs/REDESIGN-V2.md §5.1).
 *
 * The VIEW is the prototype's: one neutral chip under the translation that
 * answers "how common is this word". The number comes from the subtitle list
 * (`src/assets/frequency/en-rank.json`) through the lazy cache in
 * `shared/study/frequency` — never from an import, so the content bundle does
 * not carry 345 KB of JSON for a card the user may never open.
 *
 * Rank wins over the enriched evidence band (rank covers 21,576 lemmas); the
 * Longman/books winner is the fallback when the list has no entry, exactly as
 * the prototype renders it.
 */
import React, { useEffect, useState } from 'react';
import { fmtNumber, t } from '../../shared/i18n';
import { formatFrequencyBand, formatRankBand } from '../../shared/frequency';
import { frequency, hasFrequencyList } from '../../shared/study/frequency';

const META_CHIP = 'text-zinc-600 dark:text-zinc-300 bg-zinc-900/[0.05] dark:bg-white/[0.07]';

/** Subtitle rank of `token` in `lang`, or null while loading / no entry. */
export function useWordRank(token: string, lang: string): number | null {
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setRank(null);
    if (!token || !hasFrequencyList(lang)) {
      return () => {
        alive = false;
      };
    }
    void frequency.get(lang).then((ranks) => {
      if (alive) setRank(ranks?.rankOf(token) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [token, lang]);
  return rank;
}

export interface FrequencyBadgeProps {
  /** Subtitle rank (1 = most frequent) or null when the list has no entry. */
  rank: number | null;
  /** Longman/books winner, used only when `rank` is null. */
  fallback?: { scale: string; value: number | string } | null;
  /** Title for the fallback chip (provider attribution + corpus). */
  fallbackTitle?: string;
}

export function FrequencyBadge({ rank, fallback, fallbackTitle }: FrequencyBadgeProps): React.ReactElement | null {
  if (rank !== null) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mr-1">{t('wp.frequency')}</span>
        <span
          data-rank={rank}
          className={`text-[11px] font-medium h-5 inline-flex items-center px-1.5 rounded-md normal-case ${META_CHIP}`}
          title={t('freq.rankTitle', { rank: fmtNumber(rank) })}
        >
          {formatRankBand(rank, t)}
        </span>
      </div>
    );
  }
  if (fallback) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mr-1">{t('wp.frequency')}</span>
        <span
          className={`text-[11px] font-medium h-5 inline-flex items-center px-1.5 rounded-md normal-case ${META_CHIP}`}
          title={fallbackTitle ?? `${fallback.scale}: ${fallback.value}`}
        >
          {formatFrequencyBand(fallback.scale, fallback.value, t)}
        </span>
      </div>
    );
  }
  return null;
}