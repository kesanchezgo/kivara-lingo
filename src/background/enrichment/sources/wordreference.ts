/**
 * WordReference scraper — VIP source.
 *
 * `wordreference.com` is a community-curated translator dictionary
 * loved for natural EN-ES / EN-FR equivalents. Pattern reference:
 * `FedericoVaga/PyWordReference`.
 *
 * Markup verified 2026-04:
 *   - `<table class="WRD">` translation table
 *   - `<td class="ToWrd">` target word column (Spanish)
 *   - `<td class="FrEx">` source-language example
 *   - `<td class="ToEx">` target-language example
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const WORDREFERENCE_ORIGIN = 'https://www.wordreference.com';

const PAIR: Record<string, string> = {
  'en-es': 'enes',
  'es-en': 'esen',
  'en-fr': 'enfr',
  'fr-en': 'fren',
  'en-it': 'enit',
  'it-en': 'iten',
  'en-de': 'ende',
  'de-en': 'deen',
  'en-pt': 'enpt',
  'pt-en': 'pten',
};

async function ensureHumanCookie(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.cookies?.set) return;
  try {
    await chrome.cookies.set({
      url: `${WORDREFERENCE_ORIGIN}/`,
      name: 'nginx_wr_human',
      value: '1',
      domain: '.wordreference.com',
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    });
  } catch {
    // A normal WordReference visit may already have established the cookie.
  }
}

export const wordReferenceSource: EnrichmentSource = {
  id: 'wordReference',
  label: 'WordRef',
  async enrich(token, ctx): Promise<SourcePartial> {
    const code = PAIR[`${(ctx.sourceLang || 'en').slice(0, 2)}-${(ctx.targetLang || 'es').slice(0, 2)}`];
    if (!code) return {};
    const slug = encodeURIComponent(token.trim().toLowerCase());
    const url = `${WORDREFERENCE_ORIGIN}/${code}/${slug}`;
    await ensureHumanCookie();
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      credentials: 'include',
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    const translations = extractByClass(html, 'ToWrd', 'td')
      .map(stripHtml)
      // WR appends the part of speech after the word; trim it.
      .map((s) => s.split(/\s+(?:nf|nm|adj|adv|vt|vi|prep|pron|conj|det|noun|verb|adjective)\b/i)[0])
      .map((s) => s.trim())
      // Drop the language header cells ("Inglés" / "Español") that WR
      // renders as the first `ToWrd` of every results table, and any
      // empty residue.
      .filter((s) => s && s.length < 60 && !/^(?:Inglés|Español|English|Spanish|Principal Translations|Compound Forms)$/i.test(s));
    if (translations.length) {
      partial.translations = Array.from(new Set(translations)).slice(0, 6);
    }

    const examples: Array<{ text: string; translation?: string }> = [];
    // Pair examples inside the same table row. Pairing the two global column
    // arrays shifts translations whenever WR inserts a source-only row, which
    // previously attached unrelated Spanish sentences to `forget` and idioms.
    const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    for (const row of rows) {
      const sourceText = extractByClass(row, 'FrEx', 'td').map(stripHtml).find(Boolean);
      const targetText = extractByClass(row, 'ToEx', 'td').map(stripHtml).find(Boolean);
      if (sourceText && targetText && sourceText.length > 8 && sourceText.length < 220) {
        examples.push({ text: sourceText, translation: targetText });
      }
      if (examples.length >= 4) break;
    }
    if (examples.length) partial.examples = examples;

    return partial;
  },
};
