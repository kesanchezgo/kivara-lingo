/**
 * Thesaurus.com synonyms/antonyms scraper.
 *
 *   GET https://www.thesaurus.com/browse/<word>
 *
 * Fills the antonym gap left by Wiktionary, Datamuse and WordHippo for
 * single-word abstract / technical nouns where the others return
 * nothing. Verified live for "algorithm" (5 antonyms: deviation,
 * idleness, ignorance, inaction, inactivity), and broad coverage for
 * common nouns ("apple" → 66 antonyms, "house" → 157 antonyms,
 * "computer" → 29 antonyms).
 *
 * Page structure (verified live 2026-05):
 *   <section class="synonym-antonym-panel">
 *     <div class="synonym-antonym-panel-label">Antonyms</div>
 *     <a class="word-chip synonym-antonym-word-chip similarity-50"
 *        href="...">blueprint</a> ... etc.
 *   </section>
 *
 * The page exposes multiple panels — one for each (PoS × sense). We
 * sweep them all and collect anything labelled "Antonyms" / "Synonyms".
 *
 * License: editorial site, fair-use snippet (attribution surfaced via
 * the source badge in the popover). No token. SW-safe.
 *
 * NB: thesaurus.com sometimes serves a JS-only shell behind Cloudflare
 * for non-browser fingerprints. We only pass the headers required for
 * the SSR HTML response (the SW's TLS fingerprint typically passes the
 * Cloudflare gate; if it ever doesn't, the source returns `{}` and the
 * orchestrator's other sources fill in).
 */

import { fetchHtml } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

function clean(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const thesaurusComSource: EnrichmentSource = {
  id: 'thesaurusCom',
  label: 'Thesaurus.com',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};
    // Single word only — multi-word slugs always 404 here.
    if (/\s/.test(token.trim())) return {};
    const slug = token.trim().toLowerCase();
    if (!slug) return {};
    const url = `https://www.thesaurus.com/browse/${encodeURIComponent(slug)}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!html) return {};

    const partial: SourcePartial = {};
    const synonyms = new Set<string>();
    const antonyms = new Set<string>();

    // Panels are repeated per (PoS × sense). Sweep all of them.
    const panelRe =
      /<section\s+class\s*=\s*["']synonym-antonym-panel["']\s*>([\s\S]*?)<\/section>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = panelRe.exec(html))) {
      const panel = pm[1];
      const labelM =
        /<div\s+class\s*=\s*["']synonym-antonym-panel-label["']\s*>\s*([^<]+?)\s*<\/div>/i.exec(
          panel,
        );
      if (!labelM) continue;
      const label = labelM[1].trim().toLowerCase();
      const target =
        label === 'synonyms' ? synonyms : label === 'antonyms' ? antonyms : null;
      if (!target) continue;
      const chipRe =
        /<a[^>]+class\s*=\s*["']word-chip\s+synonym-antonym-word-chip[^"']*["'][^>]*>\s*([^<]+?)\s*<\/a>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = chipRe.exec(panel))) {
        const word = clean(cm[1]);
        if (word && word.length > 1 && word.length < 40) target.add(word);
      }
    }

    if (synonyms.size) partial.synonyms = Array.from(synonyms).slice(0, 12);
    if (antonyms.size) partial.antonyms = Array.from(antonyms).slice(0, 8);

    return partial;
  },
};
