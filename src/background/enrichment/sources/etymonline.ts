/**
 * Etymology Online (`etymonline.com`) scraper — VIP source for the
 * etymology block on the card back.
 *
 * Pattern verified live 2026-05. The site is a Next.js app — the
 * etymology body lives inside:
 *
 *   <section class="prose-lg dark:prose-dark max-w-none">
 *     <div><h2>...<span lang="en">excuse</span>(v.)</h2></div>
 *     <section class="-mt-4 -mb-2 lg:-mb-2">
 *       <p>mid-13c., "...", from Old French <i>escuser</i>...</p>
 *       <p>Sense of "...", is from 1530s. Related: ...</p>
 *     </section>
 *   </section>
 *
 * We grab the inner `<section>` (the one without the `prose-lg` class
 * sitting next to the `<h2>`) and pull every `<p>` from it. That gives
 * us the etymology paragraphs without any of the surrounding chrome.
 *
 * NOTE: previous draft used `class="word__defination"` (legacy markup)
 * which no longer exists. Audit run on 2026-05-22 confirmed the
 * `prose-lg` pattern above is the live one.
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

    // First, find the outer prose-lg wrapper. There may be multiple on
    // the page (one per part-of-speech variant). We use the first one.
    const proseSections = extractByClass(html, 'prose-lg', 'section');
    if (proseSections.length === 0) return {};
    const wrapper = proseSections[0];

    // Inside the wrapper, the etymology body is the inner <section>.
    // Match the first `<section ...>...</section>` inside it.
    const innerSec = /<section\b[^>]*>([\s\S]*?)<\/section>/i.exec(wrapper);
    const body = innerSec ? innerSec[1] : wrapper;

    // Pull every <p>...</p>
    const paragraphs: string[] = [];
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(body))) {
      const text = stripHtml(m[1]);
      if (text && text.length > 20) paragraphs.push(text);
      if (paragraphs.length >= 3) break;
    }
    if (paragraphs.length === 0) return {};

    // Combine first 1–2 paragraphs (etymology stays digestible).
    const combined = paragraphs.slice(0, 2).join(' ');
    const trimmed = combined.length > 360 ? combined.slice(0, 357) + '…' : combined;
    return { etymology: trimmed };
  },
};
