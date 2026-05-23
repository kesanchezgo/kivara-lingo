/**
 * Tatoeba sentence-pair scraper — VIP source.
 *
 * Tatoeba is a community-built parallel corpus of native-speaker
 * sentences. The public web search endpoint is the only stable way to
 * get bilingual sentence pairs without an API key:
 *
 *   GET https://tatoeba.org/api_v0/search?from=eng&to=spa&query=<word>
 *
 * Verified live 2026-05 returning JSON shape:
 *   {
 *     paging: {...},
 *     results: [
 *       {
 *         id, text, lang, ...,
 *         translations: [
 *           [
 *             { id, text, lang, isDirect, ... }
 *           ]
 *         ]
 *       }
 *     ]
 *   }
 *
 * Each result is a source-language sentence with one or more nested
 * translations. We keep the first direct translation per sentence as
 * the example pair.
 *
 * NOTE: previous draft used `/eng/api_v0/sentences?...` which returns
 * 404 — the working URL has no locale prefix and uses `search` (not
 * `sentences`). Audit run on 2026-05-22 confirmed this URL.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_MAP: Record<string, string> = {
  en: 'eng',
  es: 'spa',
  fr: 'fra',
  de: 'deu',
  it: 'ita',
  pt: 'por',
  ru: 'rus',
  ja: 'jpn',
  zh: 'cmn',
  ko: 'kor',
};

interface TatoebaTranslation {
  id?: number;
  text?: string;
  lang?: string;
  isDirect?: boolean;
}

interface TatoebaResult {
  id?: number;
  text?: string;
  lang?: string;
  translations?: TatoebaTranslation[][];
}

interface TatoebaResponse {
  results?: TatoebaResult[];
}

export const tatoebaSource: EnrichmentSource = {
  id: 'tatoeba',
  label: 'Tatoeba',
  async enrich(token, ctx): Promise<SourcePartial> {
    const from = LANG_MAP[(ctx.sourceLang || 'en').slice(0, 2)];
    const to = LANG_MAP[(ctx.targetLang || 'es').slice(0, 2)];
    if (!from || !to || from === to) return {};

    const url =
      `https://tatoeba.org/api_v0/search` +
      `?from=${from}&to=${to}` +
      `&query=${encodeURIComponent(token)}` +
      `&sort=relevance`;

    const data = await fetchJson<TatoebaResponse>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!data?.results?.length) return {};

    const examples: Array<{ text: string; translation?: string }> = [];
    for (const r of data.results) {
      const text = (r.text || '').trim();
      if (!text || text.length < 8 || text.length > 220) continue;
      // translations is an array of arrays (direct + indirect groups).
      // Take the first direct translation.
      let translation: string | undefined;
      for (const group of r.translations ?? []) {
        for (const t of group ?? []) {
          if (t.text) {
            translation = t.text.trim();
            break;
          }
        }
        if (translation) break;
      }
      examples.push({ text, translation });
      if (examples.length >= 6) break;
    }

    if (!examples.length) return {};
    return { examples };
  },
};
