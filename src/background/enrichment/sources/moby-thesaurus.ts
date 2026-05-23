/**
 * Moby Thesaurus — Standard-tier synonym source.
 *
 * Public-domain thesaurus by Grady Ward (1996), served via
 * `moby-thesaurus.org` HTML. Verified live 2026-05: works without
 * token, no Cloudflare gate, returns 22-103 synonyms per common
 * word (e.g. "beautiful" → 72 synonyms in 103 <li> items).
 *
 *   GET https://moby-thesaurus.org/<word>
 *
 * Words use spaces or %20 for multi-word queries. The page uses an
 * `<ol>` with `<li>` items for each synonym; we extract them.
 *
 * For idioms / phrasals not in the core 30k Moby entries, the page
 * returns a "See Also: <related-word> ..." section that's still
 * useful as related vocabulary.
 *
 * Important: Moby is unidirectional — synonyms only, no antonyms.
 * For antonyms, fall back to Datamuse rel_ant or freedictionaryapi.
 */
import { fetchHtml } from '../fetcher';
import { stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

export const mobyThesaurusSource: EnrichmentSource = {
  id: 'mobyThesaurus',
  label: 'Moby',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};
    const slug = encodeURIComponent(token.trim());
    const url = `https://moby-thesaurus.org/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    // Each synonym is in an <li> tag. The first <li> is always a
    // promotional banner ("Hey! Check out 🍒 wordnerd.fun ..."), skip
    // anything that contains an emoji or "Check out".
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    const synonyms: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(html))) {
      const text = stripHtml(m[1]);
      if (!text || text.length === 0) continue;
      // Filter out promotional banners and overly long entries
      if (/Check out|wordnerd\.fun|🍒|^Hey/i.test(text)) continue;
      if (text.length > 60) continue;
      // Filter out the search field placeholders
      if (/^\d+$/.test(text)) continue;
      synonyms.push(text);
      if (synonyms.length >= 24) break;
    }
    if (!synonyms.length) return {};
    return { synonyms };
  },
};
