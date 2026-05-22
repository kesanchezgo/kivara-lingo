/**
 * Tatoeba Sentence Database — VIP source.
 *
 * Tatoeba is a free, community-curated parallel sentence corpus
 * (CC-BY 2.0 FR). The official API at `api.tatoeba.org/v1/sentences`
 * supports keyword search with translation filters via the `trans:lang`
 * parameter syntax (verified live 2026-05).
 *
 * Endpoint:
 *   GET /v1/sentences
 *     ?lang=<eng|spa|...>
 *     &q=<word>
 *     &trans:lang=<spa|eng|...>
 *     &limit=6
 *     &sort=created
 *
 * Returns a JSON object whose `data[]` is an array of source sentences,
 * each with a `translations[]` array of target-language pairs. We only
 * keep pairs where the translation is non-empty and short enough to fit
 * the popover.
 *
 * Why this matters: Tatoeba's corpus is the largest free parallel
 * sentence dataset on the public web. Reverso / Linguee scrape similar
 * data but are unstable mirrors; Tatoeba is the upstream source.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_3 = {
  en: 'eng',
  es: 'spa',
  fr: 'fra',
  de: 'deu',
  it: 'ita',
  pt: 'por',
  ja: 'jpn',
  zh: 'cmn',
  ko: 'kor',
  ru: 'rus',
} as const;

interface TatoebaSentence {
  id: number;
  text: string;
  lang: string;
  is_unapproved?: boolean;
  translations?: TatoebaSentence[];
}

interface TatoebaResponse {
  data?: TatoebaSentence[];
}

export const tatoebaSource: EnrichmentSource = {
  id: 'tatoeba',
  label: 'Tatoeba',
  async enrich(token, ctx): Promise<SourcePartial> {
    const src = LANG_3[(ctx.sourceLang || 'en').slice(0, 2) as keyof typeof LANG_3];
    const tgt = LANG_3[(ctx.targetLang || 'es').slice(0, 2) as keyof typeof LANG_3];
    if (!src || !tgt || src === tgt) return {};

    const t = token.trim();
    if (!t) return {};

    // Tatoeba's `q` is full-text — quoting the token forces an exact
    // match (otherwise "go" matches "gold", "good", etc.). Single-word
    // tokens benefit; multi-word phrases pass through verbatim.
    const quoted = t.includes(' ') ? `"${t}"` : t;
    const url =
      `https://api.tatoeba.org/v1/sentences` +
      `?lang=${src}` +
      `&q=${encodeURIComponent(quoted)}` +
      `&trans%3Alang=${tgt}` +
      `&limit=6&sort=created`;

    const data = await fetchJson<TatoebaResponse>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!data?.data?.length) return {};

    const examples: Array<{ text: string; translation?: string }> = [];
    for (const s of data.data) {
      if (s.is_unapproved) continue;
      const text = (s.text ?? '').trim();
      if (!text || text.length < 8 || text.length > 220) continue;
      const tr = (s.translations ?? []).find(
        (x) => x.lang === tgt && x.text && !x.is_unapproved,
      );
      const translation = tr?.text?.trim();
      examples.push({ text, translation: translation || undefined });
      if (examples.length >= 5) break;
    }
    if (!examples.length) return {};
    return { examples };
  },
};
