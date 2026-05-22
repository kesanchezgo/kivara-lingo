/**
 * Etymology Online (`etymonline.com`) scraper — VIP source for the
 * etymology block on the card back.
 *
 * Markup verified 2026-04:
 *   - `<section class="word__defination">` (typo in their CSS, sic)
 *   - `<p>` paragraphs inside it carry the etymology body.
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

export const etymonlineSource: EnrichmentSource = {
  id: 'etymonline',
  label: 'Etymology',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim().toLowerCase());
    const url = `https://www.etymonline.com/word/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    // The etymology body is the first `<p>` inside any element whose
    // class contains "word__defination" or "word__definition".
    const bodies = [
      ...extractByClass(html, 'word__defination', 'section'),
      ...extractByClass(html, 'word__definition', 'section'),
    ];
    if (bodies.length === 0) return {};

    const body = stripHtml(bodies[0]);
    if (!body || body.length < 20) return {};
    // Truncate to first ~3 sentences so the card stays digestible.
    const sentences = body.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
    const trimmed = sentences.length > 360 ? sentences.slice(0, 357) + '…' : sentences;
    return { etymology: trimmed };
  },
};
