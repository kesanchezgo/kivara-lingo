/**
 * DuckDuckGo image search — VIP image source.
 *
 * DuckDuckGo's `i.js` JSON endpoint is the most reliable image-search
 * fallback when Pixabay / Wikimedia Commons / Bing don't have a
 * relevant photo. The endpoint requires a vqd token from the search
 * landing page first — same dance every browser does.
 *
 * Two-request flow:
 *   1. GET `https://duckduckgo.com/?q=<word>&iax=images&ia=images`
 *      and extract `vqd='<token>'` from the response HTML.
 *   2. GET `https://duckduckgo.com/i.js?q=<word>&vqd=<token>` which
 *      returns `{ results: [{ image, thumbnail, ... }] }`.
 *
 * Verified live 2026-05: the `i.js` endpoint requires the same
 * `Sec-Fetch-*` headers a real browser XHR sends, otherwise it
 * returns 403 (a new bot-detection layer, not a vqd issue):
 *   - Sec-Fetch-Dest: empty
 *   - Sec-Fetch-Mode: cors
 *   - Sec-Fetch-Site: same-origin
 *   - Referer: https://duckduckgo.com/
 *   - X-Requested-With: XMLHttpRequest
 *
 * With those headers DDG ships ~90 image hits per query.
 */

import { fetchHtml, fetchJson } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

interface DdgResults {
  results?: Array<{ image?: string; thumbnail?: string }>;
}

export const duckduckgoImagesSource: EnrichmentSource = {
  id: 'duckduckgoImages',
  label: 'DuckDuckGo',
  async enrich(token, ctx): Promise<SourcePartial> {
    const q = encodeURIComponent(token.trim());
    const landingUrl = `https://duckduckgo.com/?q=${q}&iax=images&ia=images`;
    const landingHtml = await fetchHtml(landingUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!landingHtml) return {};
    const vqdMatch = /vqd\s*=\s*['"]([^'"]+)['"]/i.exec(landingHtml);
    if (!vqdMatch) return {};
    const vqd = vqdMatch[1];

    const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${encodeURIComponent(vqd)}&p=1`;
    const data = await fetchJson<DdgResults>(apiUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        // Same headers a real browser XHR sends — DDG enforces these
        // since 2025 to filter out scrapers that only set Referer.
        Referer: 'https://duckduckgo.com/',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json,text/javascript,*/*; q=0.01',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    const first = data?.results?.[0];
    const url = first?.image || first?.thumbnail;
    if (!url) return {};
    return { imageUrl: url };
  },
};
