/**
 * theidioms.com scraper — origin + meaning of English idioms.
 *
 *   GET https://www.theidioms.com/<slug>/
 *
 * Best free source for idiom etymology — covers expressions Wiktionary's
 * Etymology section omits or buries under language stubs (kick the
 * bucket, piece of cake, big deal, etc.). Skips silently for non-idiom
 * tokens (single-word lookups always 404 here).
 *
 * Page structure (verified live 2026-05):
 *   <h2>Meaning | Synonyms</h2>
 *     <p>...meaning paragraph...</p>
 *   <h2>Origin</h2>
 *     <p>...origin/etymology paragraph...</p>
 *
 * License: editorial site, fair-use snippet (attribution surfaced via
 * the source badge in the popover). No token. SW-safe.
 */

import { fetchHtml } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

function clean(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull the first `<p>...</p>` block following the matched heading. */
function extractParagraphAfter(html: string, headingPattern: RegExp): string | null {
  const idx = html.search(headingPattern);
  if (idx < 0) return null;
  const after = html.slice(idx);
  const m = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(after);
  return m ? clean(m[1]) : null;
}

export const theIdiomsSource: EnrichmentSource = {
  id: 'theIdioms',
  label: 'TheIdioms',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};
    // Site only carries multi-word idioms — skip single tokens.
    if (!/\s/.test(token.trim())) return {};
    const slug = token.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) return {};
    const url = `https://www.theidioms.com/${encodeURIComponent(slug)}/`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: { Accept: 'text/html' },
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    // Origin → maps to `etymology` field.
    const origin = extractParagraphAfter(html, /<h2[^>]*>\s*Origin\b[^<]*<\/h2>/i);
    if (origin && origin.length > 30) {
      partial.etymology = origin.length > 360 ? origin.slice(0, 357) + '…' : origin;
    }

    // Meaning → maps to `definitions`.
    const meaning = extractParagraphAfter(html, /<h2[^>]*>\s*Meaning\b[^<]*<\/h2>/i);
    if (meaning && meaning.length > 10 && meaning.length < 400) {
      partial.definitions = [meaning];
    }

    return partial;
  },
};
