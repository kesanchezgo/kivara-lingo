/**
 * Lingua Libre — VIP source.
 *
 * Lingua Libre is a Wikimedia project that hosts CC-BY-SA pronunciations
 * recorded by native speakers. It exposes a SPARQL endpoint and a REST
 * API at `lingualibre.org/api.php`.
 *
 * We use the simpler search-and-resolve flow:
 *   1. `https://commons.wikimedia.org/w/api.php?action=query&list=search
 *       &srsearch=LinguaLibre-<lang>-<word>&format=json`
 *   2. Extract `File:LL-Q*.ogg` titles, resolve each to a Commons URL
 *      via `prop=imageinfo`.
 *
 * Returns up to 4 audio URLs (Vorbis OGG — modern browsers play these
 * natively).
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_QID: Record<string, string> = {
  en: 'Q1860',     // English
  es: 'Q1321',     // Spanish
  fr: 'Q150',      // French
  de: 'Q188',      // German
  it: 'Q652',      // Italian
  pt: 'Q5146',     // Portuguese
  ja: 'Q5287',     // Japanese
};

interface CommonsSearchResult {
  query?: {
    search?: Array<{ title?: string }>;
  };
}

interface CommonsImageInfo {
  query?: {
    pages?: Record<
      string,
      {
        imageinfo?: Array<{ url?: string }>;
      }
    >;
  };
}

export const linguaLibreSource: EnrichmentSource = {
  id: 'linguaLibre',
  label: 'Lingua Libre',
  async enrich(token, ctx): Promise<SourcePartial> {
    const langCode = (ctx.sourceLang || 'en').slice(0, 2);
    const qid = LANG_QID[langCode];
    if (!qid) return {};

    const t = token.trim().toLowerCase();
    if (!t) return {};

    // Lingua Libre files follow `LL-Q<langQid>-<speaker>-<word>.wav` /
    // `.ogg`. We search Commons for files whose name contains the word
    // and the language QID.
    const search = `LL-${qid}-`;
    const queryUrl =
      `https://commons.wikimedia.org/w/api.php` +
      `?action=query&list=search&format=json&origin=*` +
      `&srnamespace=6` +
      `&srsearch=${encodeURIComponent(`${search} ${t}`)}` +
      `&srlimit=4`;

    const search1 = await fetchJson<CommonsSearchResult>(queryUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const titles = (search1?.query?.search ?? [])
      .map((r) => r.title ?? '')
      .filter((x) => x && new RegExp(`-${t}\\.(wav|ogg|mp3)$`, 'i').test(x))
      .slice(0, 4);
    if (titles.length === 0) return {};

    const infoUrl =
      `https://commons.wikimedia.org/w/api.php` +
      `?action=query&prop=imageinfo&iiprop=url&format=json&origin=*` +
      `&titles=${encodeURIComponent(titles.join('|'))}`;
    const info = await fetchJson<CommonsImageInfo>(infoUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const pages = info?.query?.pages ?? {};
    const audio: Array<{ url: string; accent?: string }> = [];
    for (const p of Object.values(pages)) {
      const u = p?.imageinfo?.[0]?.url;
      if (u && /\.(wav|ogg|mp3)(\?|$)/i.test(u)) {
        audio.push({ url: u });
      }
    }
    if (!audio.length) return {};
    return { audio };
  },
};
