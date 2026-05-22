/**
 * Reverso Context scraper — VIP source.
 *
 * Reverso ships translations of source-language sentences pulled from
 * real-world parallel corpora (subtitles, news, books). Pattern based
 * on `s0ftik3/reverso-api` and `Overmiind/ReversoAPI`.
 *
 * The site has a JSON endpoint we can hit directly without HTML
 * parsing: `https://context.reverso.net/bst-query-service` (POST).
 * Returns up to 50 sentence pairs per query.
 *
 * Each pair becomes an example with `text` (source) + `translation`
 * (target). Perfect for "real" context examples.
 */

import { fetchWithTimeout } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

const QUERY_URL = 'https://context.reverso.net/bst-query-service';

interface ReversoPair {
  s_text?: string;
  t_text?: string;
}

interface ReversoResponse {
  list?: ReversoPair[];
}

const LANG_MAP: Record<string, string> = {
  en: 'english',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  ru: 'russian',
  ja: 'japanese',
  zh: 'chinese',
  ko: 'korean',
};

export const reversoSource: EnrichmentSource = {
  id: 'reverso',
  label: 'Reverso',
  async enrich(token, ctx): Promise<SourcePartial> {
    const src = LANG_MAP[(ctx.sourceLang || 'en').slice(0, 2)];
    const tgt = LANG_MAP[(ctx.targetLang || 'es').slice(0, 2)];
    if (!src || !tgt || src === tgt) return {};

    // Reverso expects POST JSON. We can't easily POST through
    // fetchWithTimeout (it's GET-only). Inline a minimal POST here.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ctx.timeoutMs);
    if (ctx.signal) ctx.signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    let data: ReversoResponse | null = null;
    try {
      const res = await fetch(QUERY_URL, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
          Origin: 'https://context.reverso.net',
          Referer: 'https://context.reverso.net/',
        },
        body: JSON.stringify({
          source_text: token,
          target_text: '',
          source_lang: src,
          target_lang: tgt,
          npage: 1,
          mode: 0,
        }),
      });
      if (!res.ok) return {};
      data = (await res.json()) as ReversoResponse;
    } catch {
      return {};
    } finally {
      clearTimeout(t);
    }

    const partial: SourcePartial = {};
    const examples: Array<{ text: string; translation?: string }> = [];
    const translations = new Set<string>();

    for (const pair of data?.list ?? []) {
      const s = (pair.s_text ?? '').replace(/<[^>]+>/g, '').trim();
      const tt = (pair.t_text ?? '').replace(/<[^>]+>/g, '').trim();
      if (!s || !tt) continue;
      // Short translations (< 4 words) are typically the headword
      // translation — shove them into translations[].
      if (tt.split(/\s+/).length <= 3 && tt.length < 40) translations.add(tt);
      if (s.length > 8 && s.length < 220) examples.push({ text: s, translation: tt });
      if (examples.length >= 6) break;
    }

    if (examples.length) partial.examples = examples;
    if (translations.size) partial.translations = Array.from(translations).slice(0, 6);
    return partial;
  },
};
