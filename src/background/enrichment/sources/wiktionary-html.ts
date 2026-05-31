/**
 * Wiktionary HTML page parser — Standard-tier extraction of etymology,
 * synonyms, antonyms, and related terms that the REST API doesn't
 * expose for multi-word phrases.
 *
 *   GET https://en.wiktionary.org/api/rest_v1/page/html/<slug>
 *
 * The HTML page has structured sections per PoS:
 *   <h3 id="Etymology">  Etymology  </h3>  ...
 *   <h4 id="Synonyms">    Synonyms   </h4>  ... <ul><li><a>syn1</a></li>...
 *   <h4 id="Antonyms">    Antonyms   </h4>  ... <ul><li><a>ant1</a></li>...
 *   <h4 id="Related_terms">  Related terms  </h4>  ...
 *
 * Verified live 2026-05 returning rich data for multi-word phrases:
 *   - "kick the bucket" → full etymology paragraph + 1 related (bucket list)
 *   - "piece of cake" → etymology since 1936 + "easy as pie"
 *   - "turn off" → 8 synonyms (shut off, switch off, ...) + 1 antonym
 *   - "give up" → 5 related (give up the ghost, ...)
 *
 * License: CC-BY-SA 4.0 (Wiktionary). No token. SW-safe (no DOM API).
 */

import { fetchHtml } from '../fetcher';
import { buildPhrasalEtymologyFallback } from '../phrasal-etymology-fallback';
import type { EnrichmentSource, SourcePartial } from '../types';

function clean(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract content between an `<h2|h3|h4 id="<sectionId>">…</hN>` marker
 * and the next `<hN id=` marker (or end of language section).
 *
 * IMPORTANT: this is called only on a slice already restricted to the
 * English language block (see `extractEnglishSection`) so we never pull
 * the etymology from another language's section.
 */
function extractSection(html: string, sectionId: string): string | null {
  // Wiktionary IDs are like "Etymology", "Etymology_2", "Synonyms_2".
  const re = new RegExp(
    `<h\\d[^>]*\\bid\\s*=\\s*["']${sectionId}(?:_\\d+)?["'][^>]*>[\\s\\S]*?<\\/h\\d>([\\s\\S]*?)(?=<h[2-4]\\b|<\\/section\\b)`,
    'i',
  );
  const m = re.exec(html);
  return m ? m[1] : null;
}

/**
 * Wiktionary articles list every language whose lemma matches the slug
 * one after another, each under its own `<h2 id="LanguageName">`. We
 * only want the English block — otherwise queries like `apple` pull the
 * etymology from Old English / Latin / Spanish entries that happen to
 * share the spelling. Returns the slice of HTML between `<h2 id="English">`
 * and the next `<h2>`, or null if the page has no English entry.
 */
function extractEnglishSection(html: string): string | null {
  const enStart = html.search(/<h2[^>]*\bid\s*=\s*["']English["'][^>]*>/i);
  if (enStart < 0) return null;
  // Skip past the heading itself.
  const after = html.slice(enStart + 200);
  const nextH2 = after.search(/<h2\b[^>]*\bid\s*=/i);
  return nextH2 > 0 ? after.slice(0, nextH2) : after;
}

/**
 * Pull `<a title="...">` link texts from a section. Filters out
 * meta/admin link titles (Wiktionary:, Talk:, Edit, view).
 */
function extractAnchorTitles(section: string, max: number): string[] {
  const re = /<a\b[^>]*title\s*=\s*["']([^"']+)["']/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    const t = m[1].trim();
    if (!t || t.length > 60) continue;
    if (/^(?:Wiktionary|Talk|Edit|view|User|Category):/i.test(t)) continue;
    if (out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export const wiktionaryHtmlSource: EnrichmentSource = {
  id: 'wiktionaryHtml',
  label: 'WiktionaryHTML',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};
    const slug = encodeURIComponent(token.trim().replace(/\s+/g, '_'));
    const url = `https://en.wiktionary.org/api/rest_v1/page/html/${slug}`;
    const headers = {
      'Api-User-Agent': 'KivaraLingo/1.0 (chrome-extension)',
      Accept: 'text/html',
    };
    // Single retry on transient failures — Wiktionary's CDN occasionally
    // serves an empty body on cold cache hits, and one quick retry
    // recovers it without amplifying load.
    let html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers,
    });
    if (!html || html.length < 1000) {
      html = await fetchHtml(url, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
        headers,
      });
    }
    if (!html) return {};

    // Restrict every parser below to the English language section so we
    // don't accidentally pull data from a co-spelled lemma in Old English
    // / Latin / Spanish that lives lower in the same article.
    const enHtml = extractEnglishSection(html);
    if (!enHtml) return {};

    const partial: SourcePartial = {};

    // Etymology — pull the FIRST <p> after the section header so we get a
    // clean prose paragraph instead of the raw section block (which can
    // include nested templates and "see also" notes).
    const etymSection = extractSection(enHtml, 'Etymology');
    if (etymSection) {
      const pMatch = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(etymSection);
      const text = pMatch ? clean(pMatch[1]) : clean(etymSection);
      if (text && text.length > 30) {
        partial.etymology = text.length > 360 ? text.slice(0, 357) + '…' : text;
      }
    }

    // Phrasal-verb fallback: if this is a 2-word "verb + particle"
    // expression ("look up", "give up", "turn on") and Wiktionary has no
    // dedicated Etymology section for the phrasal (which is very common
    // — phrasals are compositional), use the bundled head-verb
    // etymology table. Deterministic, no second network call,
    // no jitter.
    if (!partial.etymology) {
      const fallback = buildPhrasalEtymologyFallback(token);
      if (fallback) partial.etymology = fallback;
    }

    // Synonyms / Antonyms — anchor link texts.
    const synSection = extractSection(enHtml, 'Synonyms');
    if (synSection) {
      const syns = extractAnchorTitles(synSection, 12);
      if (syns.length) partial.synonyms = syns;
    }

    const antSection = extractSection(enHtml, 'Antonyms');
    if (antSection) {
      const ants = extractAnchorTitles(antSection, 8);
      if (ants.length) partial.antonyms = ants;
    }

    // Related terms / Derived terms / See also — surface as
    // collocations since they're naturally co-occurring word forms.
    const relations: string[] = [];
    for (const sectionId of ['Related_terms', 'Derived_terms', 'See_also']) {
      const sec = extractSection(enHtml, sectionId);
      if (sec) {
        const items = extractAnchorTitles(sec, 8);
        for (const item of items) if (!relations.includes(item)) relations.push(item);
      }
    }
    if (relations.length) {
      // Filter out variant forms of the headword itself; keep only
      // genuine collocations.
      const lc = token.toLowerCase();
      const filtered = relations.filter((r) => r.toLowerCase() !== lc);
      if (filtered.length) partial.collocations = filtered.slice(0, 10);
    }

    return partial;
  },
};
