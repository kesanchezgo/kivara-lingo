/**
 * WordHippo antonyms scraper.
 *
 *   GET https://www.wordhippo.com/what-is/the-opposite-of/<slug>.html
 *
 * WordHippo is a popular thesaurus/antonym site that — uniquely — has
 * antonym entries for compound MWEs, phrasal verbs and idioms that no
 * other free source covers (kick the bucket → bring back to life,
 * piece of cake → tall order, big deal → small potatoes, look up →
 * look down on, etc.). Crucial for closing the antonym gap left by
 * Wiktionary REST + Datamuse + WiktionaryAPI.
 *
 * Parser: WordHippo's main UI markup is JS-rendered, but it also embeds
 * a clean, deterministic `<meta property="og:description">` like:
 *     "Antonyms for apple include country and countryside."
 *     "Antonyms for kick the bucket include come to life, ..."
 *
 * We parse that single tag — it's the most stable selector on the
 * page and survives layout overhauls. Slug uses underscores for
 * multi-word phrases (apple → /apple.html, kick the bucket →
 * /kick_the_bucket.html).
 *
 * No token. SW-safe (no DOM API).
 */

import { fetchHtml } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

export const wordHippoSource: EnrichmentSource = {
  id: 'wordHippo',
  label: 'WordHippo',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};
    const slug = token.trim().toLowerCase().replace(/\s+/g, '_');
    if (!slug) return {};
    const url = `https://www.wordhippo.com/what-is/the-opposite-of/${encodeURIComponent(slug)}.html`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: { Accept: 'text/html' },
    });
    if (!html) return {};

    // Pull `<meta property="og:description" content="..." />` and parse.
    const metaRe =
      /<meta\s+property\s*=\s*["']og:description["']\s+content\s*=\s*["']([^"']+)["']/i;
    const m = metaRe.exec(html);
    if (!m) return {};
    const desc = m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    // Format always starts with "Antonyms for <term> include <list>."
    // — capture the comma-separated list, stripping the leading prefix.
    const listMatch = /(?:Antonyms?|Opposite\s+(?:of|words))[\s\S]+?include\s+([^.]+)\./i.exec(desc);
    if (!listMatch) return {};
    const raw = listMatch[1];
    // Split on commas + final "and".
    const items = raw
      .split(/,\s*|\s+and\s+/i)
      .map((s) => s.trim())
      .filter((s) => s && s.length > 1 && s.length < 60 && !/find\s+more/i.test(s));

    return items.length ? { antonyms: items.slice(0, 8) } : {};
  },
};
