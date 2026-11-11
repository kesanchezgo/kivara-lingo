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
  const title = (titleText ?? docTitle).trim();
  const series = seriesText?.trim() || undefined;

  return {
    platform,
    title,
    series,
    season: parsed?.season,
    episode: parsed?.episode,
    url: currentUrl(),
  };
}

/** YouTube reads the player response the page already fetched. */
export function getYouTubeMediaInfo(): MediaInfo {
  const details = (globalThis as {
    ytInitialPlayerResponse?: { videoDetails?: { title?: string; videoId?: string; author?: string } };
  }).ytInitialPlayerResponse?.videoDetails;
  const domTitle = firstText([
    'ytd-watch-metadata #title h1',
    'h1.ytd-watch-metadata',
    '#title h1',
  ]);
  const title = (details?.title ?? domTitle ?? cleanDocumentTitle(['Watch '], [' - YouTube'])).trim();
  return {
    platform: 'youtube',
    title,
    url: currentUrl(),
  };
}
