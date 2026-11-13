/**
 * Best-effort `getMediaInfo()` for every platform (docs/REDESIGN-V2.md §4.5).
 *
 * The card tags and the Anki `source` field need series/episode metadata, and
 * every streaming site exposes it differently (and changes the DOM without
 * notice). Each adapter supplies its selectors; the parsing below is shared so
 * `S01E02`, `S1 E2`, `S1:E2`, `1x02`, `Season 1 Episode 2` and the Spanish
 * spellings all resolve. Anything missing is simply absent — the adapter never
 * throws and never blocks the save.
 */

import type { MediaInfo, MediaPlatform } from '../../shared/types';

export interface MediaInfoOptions {
  /** Elements that carry the episode or movie title. */
  titleSelectors?: string[];
  /** Elements that carry the series name. */
  seriesSelectors?: string[];
  /** Extra text to scan for a season/episode code. */
  episodeSelectors?: string[];
  /** Suffixes to strip from `document.title` (e.g. " | Netflix"). */
  titleSuffixes?: string[];
  /** Prefixes to strip from `document.title` (e.g. "Watch "). */
  titlePrefixes?: string[];
  /**
   * Titles that name only the platform (e.g. "Netflix", "YouTube") and carry
   * no media information. They resolve to an empty title so a caller can never
   * build a series tag from the platform name.
   */
  genericTitles?: string[];
}

const EPISODE_PATTERNS: Array<{ re: RegExp; season: number; episode: number }> = [
  { re: /\bs(?:eason)?\s*0*(\d{1,3})\s*[:·\-]?\s*e(?:p(?:isode)?)?\s*0*(\d{1,4})\b/i, season: 1, episode: 2 },
  { re: /\b(?:season|temporada)\s*0*(\d{1,3})\s*[,·\-:]?\s*(?:episode|episodio|ep\.?)\s*0*(\d{1,4})\b/i, season: 1, episode: 2 },
  { re: /\b0*(\d{1,3})x0*(\d{1,4})\b/, season: 1, episode: 2 },
];

interface ParsedEpisode {
  season: number;
  episode: number;
  raw: string;
}

export function parseEpisode(text: string): ParsedEpisode | undefined {
  for (const { re, season, episode } of EPISODE_PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    const s = Number(match[season]);
    const e = Number(match[episode]);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    return { season: s, episode: e, raw: match[0] };
  }
  return undefined;
}

function firstText(selectors?: string[]): string | undefined {
  for (const selector of selectors ?? []) {
    try {
      const el = document.querySelector(selector);
      const text = el?.textContent?.replace(/\s+/g, ' ').trim();
      if (text) return text;
    } catch {
      // A selector the current DOM revision no longer accepts: try the next.
    }
  }
  return undefined;
}

function cleanDocumentTitle(prefixes?: string[], suffixes?: string[]): string {
  let title = document.title.replace(/\s+/g, ' ').trim();
  for (const prefix of prefixes ?? []) {
    if (title.toLowerCase().startsWith(prefix.toLowerCase())) title = title.slice(prefix.length).trim();
  }
  for (const suffix of suffixes ?? []) {
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) title = title.slice(0, -suffix.length).trim();
  }
  return title;
}

/** Current URL, guarded for non-browser callers (tests). */
function currentUrl(): string {
  return typeof window !== 'undefined' ? window.location.href : '';
}

/** True when `title` is missing or names nothing but the platform itself. */
function isGenericTitle(title: string | undefined, genericTitles?: string[]): boolean {
  const value = title?.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!value) return true;
  return (genericTitles ?? []).some(
    (name) => name.replace(/\s+/g, ' ').trim().toLowerCase() === value,
  );
}

/**
 * Generic DOM/title extraction. Every platform adapter calls this with its own
 * selectors; a page that exposes nothing still gets `document.title`.
 */
export function getDomMediaInfo(
  platform: MediaPlatform,
  options: MediaInfoOptions = {},
): MediaInfo {
  const docTitle = cleanDocumentTitle(options.titlePrefixes, options.titleSuffixes);
  const titleText = firstText(options.titleSelectors);
  const seriesText = firstText(options.seriesSelectors);
  const episodeText = firstText(options.episodeSelectors);

  const scanned = [titleText, episodeText, seriesText, docTitle].filter(Boolean).join(' · ');
  const parsed = parseEpisode(scanned);

  // A platform that shows the episode code next to the title is the normal
  // case; strip it only from the `title` when a separate series exists.
  const rawTitle = (titleText ?? docTitle).trim();
  const title = isGenericTitle(rawTitle, options.genericTitles) ? '' : rawTitle;
  const rawSeries = seriesText?.trim();
  const series = isGenericTitle(rawSeries, options.genericTitles) ? undefined : rawSeries;

  return {
    platform,
    title,
    series,
    season: parsed?.season,
    episode: parsed?.episode,
    url: currentUrl(),
  };
}

/**
 * Message names of the YouTube metadata query. The player response
 * (`ytInitialPlayerResponse` / `movie_player.getPlayerResponse()`) only exists
 * in the page's MAIN world, so the ISOLATED content script asks for it over
 * the same `postMessage` channel the subtitle bridge already uses.
 */
const MEDIA_INFO_CMD = 'kivara-lingo:media-info';
export const MEDIA_INFO_RESULT = 'kivara-lingo:media-info-result';

/** The slice of `videoDetails` the tags need. */
export interface PlayerMediaDetails {
  title?: string;
  videoId?: string;
  author?: string;
}

/** Same `<html data-kivara-nonce>` contract as `intercepted-bus.ts`. */
function bridgeNonce(): string {
  if (typeof document === 'undefined') return '';
  return document.documentElement.getAttribute('data-kivara-nonce') ?? '';
}

function currentVideoId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URL(window.location.href).searchParams.get('v');
  } catch {
    return null;
  }
}

/** Last player response the MAIN world answered, kept across DOM rebuilds. */
let bridgeDetails: PlayerMediaDetails | null = null;
let bridgeListening = false;
let lastRequestAt = 0;
let lastRequestVideoId: string | null = null;
const BRIDGE_REQUEST_MIN_INTERVAL_MS = 1000;

function ensureBridgeListener(): void {
  if (bridgeListening || typeof window === 'undefined') return;
  bridgeListening = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | { source?: unknown; nonce?: unknown; details?: unknown }
      | null;
    if (!data || typeof data !== 'object' || data.source !== MEDIA_INFO_RESULT) return;
    if (data.nonce !== bridgeNonce()) return;
    const details = data.details as PlayerMediaDetails | null | undefined;
    if (!details || typeof details !== 'object') return;
    if (typeof details.title !== 'string' || !details.title.trim()) return;
    bridgeDetails = details;
  });
}

/**
 * Ask the MAIN world for the player response. Fire-and-forget: the reply lands
 * through the listener above and the next `getMediaInfo()` call uses it.
 */
function requestYoutubeMediaInfoFromMainWorld(): void {
  ensureBridgeListener();
  const nonce = bridgeNonce();
  if (!nonce) return;
  try {
    window.postMessage({ source: MEDIA_INFO_CMD, nonce }, '*');
  } catch {
    // Page navigating away — the next read falls back to the DOM.
  }
}

function maybeRequestYoutubeMediaInfo(videoId: string | null): void {
  if (bridgeDetails && (!videoId || bridgeDetails.videoId === videoId)) return;
  const now = Date.now();
  if (lastRequestVideoId === videoId && now - lastRequestAt < BRIDGE_REQUEST_MIN_INTERVAL_MS) return;
  lastRequestVideoId = videoId;
  lastRequestAt = now;
  requestYoutubeMediaInfoFromMainWorld();
}

/** Test seam: forget the cached player response. */
export function resetYoutubeMediaInfoBridgeForTests(): void {
  bridgeDetails = null;
  lastRequestAt = 0;
  lastRequestVideoId = null;
}

const YOUTUBE_GENERIC_TITLES = ['YouTube'];

/**
 * YouTube metadata. The player response is queried over the MAIN bridge (the
 * global does not exist in the ISOLATED world); the watch-page heading is the
 * synchronous source, and `document.title` the last resort. A reply for a
 * different video id is ignored so an SPA navigation never reuses the previous
 * title.
 */
export function getYouTubeMediaInfo(): MediaInfo {
  const videoId = currentVideoId();
  maybeRequestYoutubeMediaInfo(videoId);
  const details = bridgeDetails && (!videoId || bridgeDetails.videoId === videoId) ? bridgeDetails : null;
  const domTitle = firstText([
    'ytd-watch-metadata #title h1',
    'h1.ytd-watch-metadata',
    '#title h1',
  ]);
  const title = (details?.title ?? domTitle ?? cleanDocumentTitle(['Watch '], [' - YouTube'])).trim();
  return {
    platform: 'youtube',
    title: isGenericTitle(title, YOUTUBE_GENERIC_TITLES) ? '' : title,
    url: currentUrl(),
  };
}
