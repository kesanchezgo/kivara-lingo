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

interface TatoebaV0Response {
  results?: TatoebaResult[];
}

interface TatoebaV1Translation {
  text?: string;
  lang?: string;
  is_direct?: boolean;
}

interface TatoebaV1Result {
  text?: string;
  translations?: TatoebaV1Translation[];
}

interface TatoebaV1Response {
  data?: TatoebaV1Result[];
}

function examplesFromV1(data: TatoebaV1Response | null): Array<{ text: string; translation?: string }> {
  const examples: Array<{ text: string; translation?: string }> = [];
  for (const result of data?.data ?? []) {
    const text = (result.text || '').trim();
    if (!text || text.length < 8 || text.length > 220) continue;
    const translations = result.translations ?? [];
    const translation = (
      translations.find((item) => item.is_direct && item.text)?.text ??
      translations.find((item) => item.text)?.text ??
      ''
    ).trim();
    examples.push({ text, translation: translation || undefined });
    if (examples.length >= 6) break;
  }
  return examples;
}

function examplesFromV0(data: TatoebaV0Response | null): Array<{ text: string; translation?: string }> {
  const examples: Array<{ text: string; translation?: string }> = [];
  for (const result of data?.results ?? []) {
    const text = (result.text || '').trim();
    if (!text || text.length < 8 || text.length > 220) continue;
    let translation: string | undefined;
    for (const group of result.translations ?? []) {
      const direct = group.find((item) => item.isDirect && item.text);
      const candidate = direct ?? group.find((item) => item.text);
      if (candidate?.text) {
        translation = candidate.text.trim();
        break;
      }
    }
    examples.push({ text, translation });
    if (examples.length >= 6) break;
  }
  return examples;
}

export const tatoebaSource: EnrichmentSource = {
  id: 'tatoeba',
  label: 'Tatoeba',
  async enrich(token, ctx): Promise<SourcePartial> {
    const from = LANG_MAP[(ctx.sourceLang || 'en').slice(0, 2)];
    const to = LANG_MAP[(ctx.targetLang || 'es').slice(0, 2)];
    if (!from || !to || from === to) return {};

    const v1Url =
      `https://api.tatoeba.org/v1/sentences` +
      `?lang=${from}` +
      `&q=${encodeURIComponent(token)}` +
      `&trans%3Alang=${to}` +
      `&sort=relevance&limit=6`;
    const v1 = await fetchJson<TatoebaV1Response>(v1Url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const v1Examples = examplesFromV1(v1);
    if (v1Examples.length) return { examples: v1Examples };

    // Keep the deprecated endpoint as a compatibility fallback while v1 settles.
    const v0Url =
      `https://tatoeba.org/api_v0/search` +
      `?from=${from}&to=${to}` +
      `&query=${encodeURIComponent(token)}` +
      `&sort=relevance`;
    const v0 = await fetchJson<TatoebaV0Response>(v0Url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const v0Examples = examplesFromV0(v0);
    return v0Examples.length ? { examples: v0Examples } : {};
  },
};
