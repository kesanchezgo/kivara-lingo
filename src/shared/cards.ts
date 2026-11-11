/**
 * Card registry types and pure state transitions (docs/REDESIGN-V2.md §3 H10,
 * §7 F4).
 *
 * The prototype kept its own client-side queue; v2 has a SINGLE owner — the
 * service worker — which publishes the last 50 cards, without media, under
 * `kvl:cards.recent` in `chrome.storage.local`. The views only read that key
 * and send commands, so every transition below has exactly one writer.
 *
 * This module is deliberately storage-free and chrome-free so the transitions
 * can be unit-tested and imported from the SW without dragging in `chrome.*`.
 */

import type { CreateCardKind, MediaInfo } from './types';
import type { CardSource, Platform } from './study/cardTags';
import { cardTags } from './study/cardTags';

export type CardStatus = 'sending' | 'saved' | 'queued' | 'failed';

/** The registry record as published to `chrome.storage.local`. */
export interface RecentCard {
  id: string;
  /** Headword or expression. */
  word: string;
  /** The subtitle line the card was built from. */
  sentence: string;
  status: CardStatus;
  kind: CreateCardKind;
  deck: string;
  lang: string;
  createdAt: number;
  savedAt?: number;
  /** Failed attempts since the last ladder reset. */
  attempts: number;
  nextRetryAt?: number;
  error?: string;
  noteId?: number;
  /** Hierarchical + legacy Anki tags already sent with the note. */
  tags: string[];
  /** Where it came from (series + episode, movie or video). */
  source?: CardSource;
  /** What media the note carries — booleans only, never the blobs (H4). */
  media?: { frame: boolean; audio: boolean; word?: boolean };
}

export const RECENT_CARDS_KEY = 'kvl:cards.recent';
export const RECENT_LIMIT = 50;
/** First-retry delay; mirrors the engine's `nextAttemptAt + 60_000`. */
export const CARD_RETRY_BASE_MS = 60_000;
export const MAX_CARD_RETRIES = 10;
/** The pre-v2 flat tag, still written so saved searches keep working (D3). */
export const LEGACY_CARD_TAG = 'kivara-lingo';

const STATUSES: CardStatus[] = ['sending', 'saved', 'queued', 'failed'];

/** Platform id of a `MediaInfo` → the `CardSource.platform` the tags know. */
function cardPlatform(platform: MediaInfo['platform']): Platform {
  return platform === 'hbo' ? 'max' : platform;
}

/** Inverse of {@link cardSourceFromMedia}, for rebuilding a retry request. */
export function mediaFromSource(source?: CardSource): MediaInfo | undefined {
  if (!source) return undefined;
  const platform: MediaInfo['platform'] | null =
    source.platform === 'max' ? 'hbo'
      : source.platform === 'generic' || source.platform === 'netflix'
        || source.platform === 'disney' || source.platform === 'prime'
        || source.platform === 'youtube' ? source.platform
        : null;
  if (!platform) return undefined;
  return {
    platform,
    title: source.title ?? source.series ?? '',
    series: source.series,
    season: source.season,
    episode: source.episode,
    url: '',
  };
}

/** Project adapter metadata into the shape `cardTags` expects. */
export function cardSourceFromMedia(media?: MediaInfo): CardSource | undefined {
  if (!media) return undefined;
  return {
    platform: cardPlatform(media.platform),
    series: media.series,
    season: media.season,
    episode: media.episode,
    title: media.title,
  };
}

/**
 * Hierarchical v2 tags PLUS the legacy `kivara-lingo` tag (D3). Deduped so a
 * caller never sends AnkiConnect a repeated tag.
 */
export function buildCardTags(
  kind: CreateCardKind,
  media?: MediaInfo,
  lang?: string,
): string[] {
  const tags = cardTags(kind, cardSourceFromMedia(media), lang);
  if (!tags.includes(LEGACY_CARD_TAG)) tags.push(LEGACY_CARD_TAG);
  return [...new Set(tags)];
}

/** New registry id. `crypto.randomUUID` in the browser, time-based fallback. */
export function newCardId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  return typeof cryptoApi?.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface NewRecentCard {
  id?: string;
  word: string;
  sentence: string;
  kind: CreateCardKind;
  deck: string;
  lang: string;
  tags: string[];
  source?: CardSource;
  media?: RecentCard['media'];
  createdAt?: number;
}

/** A fresh registry record, already in the `sending` state. */
export function newRecentCard(input: NewRecentCard): RecentCard {
  return {
    id: input.id ?? newCardId(),
    word: input.word,
    sentence: input.sentence,
    status: 'sending',
    kind: input.kind,
    deck: input.deck,
    lang: input.lang,
    createdAt: input.createdAt ?? Date.now(),
    attempts: 0,
    tags: input.tags,
    source: input.source,
    media: input.media,
  };
}

/** `sending` again before an attempt (manual retry / engine drain). */
export function beginRetry(card: RecentCard): RecentCard {
  return { ...card, status: 'sending', nextRetryAt: undefined, error: undefined };
}

/**
 * The note now exists in Anki. `stored` is what the worker ACTUALLY wrote —
 * a retry can succeed without the frame (or the original clip) the first
 * attempt intended, so the row must describe the note that exists instead of
 * repeating the intent. `word` is kept when the caller does not report it.
 */
export function markSaved(
  card: RecentCard,
  noteId: number,
  now = Date.now(),
  stored?: { frame: boolean; audio: boolean },
): RecentCard {
  return {
    ...card,
    status: 'saved',
    noteId,
    savedAt: now,
    attempts: 0,
    nextRetryAt: undefined,
    error: undefined,
    media: stored ? { ...card.media, ...stored } : card.media,
  };
}

/** The saved note carries a live frame. Reads reality, not intent. */
export function hasFrame(card: RecentCard): boolean {
  return card.status === 'saved' && card.media?.frame === true;
}

/** The saved note carries audio (cue clip, word audio or TTS). */
export function hasAudio(card: RecentCard): boolean {
  return card.status === 'saved' && card.media?.audio === true;
}

/** Backoff that mirrors the engine's `pending_notes` schedule (60 s, 2 min, …). */
export function retryDelayMs(attempts: number): number {
  return Math.min(CARD_RETRY_BASE_MS * 30, CARD_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** A transport failure that the retry queue will pick up again. */
export function markQueued(card: RecentCard, error: string, now = Date.now()): RecentCard {
  const attempts = card.attempts + 1;
  return {
    ...card,
    status: 'queued',
    attempts,
    error,
    nextRetryAt: now + retryDelayMs(attempts),
  };
}

/** A permanent failure: an API key, a validation error, an HTTP 4xx. */
export function markFailed(card: RecentCard, error: string): RecentCard {
  return { ...card, status: 'failed', error, nextRetryAt: undefined };
}

export function isPending(card: RecentCard): boolean {
  return card.status === 'sending' || card.status === 'queued' || card.status === 'failed';
}

/**
 * Keep every pending card; from the saved history only the newest fit, so the
 * registry never exceeds `RECENT_LIMIT`. Order is newest-first.
 */
export function trimCards(list: RecentCard[]): RecentCard[] {
  let budget = Math.max(0, RECENT_LIMIT - list.filter((c) => c.status !== 'saved').length);
  return list.filter((c) => {
    if (c.status !== 'saved') return true;
    if (budget <= 0) return false;
    budget -= 1;
    return true;
  });
}

function isCardStatus(value: unknown): value is CardStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

/**
 * Validate what was read from disk. A malformed row is dropped; an interrupted
 * `sending` row (the SW was torn down mid-send) goes back to `queued` so the
 * retry alarm can finish it.
 */
export function reviveCards(raw: unknown): RecentCard[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .filter((row): row is RecentCard => {
      if (!row || typeof row !== 'object') return false;
      const r = row as Partial<RecentCard>;
      return (
        typeof r.id === 'string'
        && typeof r.word === 'string'
        && typeof r.sentence === 'string'
        && isCardStatus(r.status)
      );
    })
    .map((card) => ({
      ...card,
      kind: card.kind ?? 'word',
      deck: typeof card.deck === 'string' ? card.deck : '',
      lang: typeof card.lang === 'string' ? card.lang : 'en',
      attempts: typeof card.attempts === 'number' ? card.attempts : 0,
      tags: Array.isArray(card.tags) ? card.tags.filter((t): t is string => typeof t === 'string') : [],
    }))
    .map((card) =>
      card.status === 'sending'
        ? { ...card, status: 'queued' as const, nextRetryAt: now + 2_000 }
        : card,
    );
}
