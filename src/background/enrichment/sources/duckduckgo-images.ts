/**
 * DuckDuckGo image search — VIP image source.
 *
 * DuckDuckGo's `i.js` JSON endpoint is the most reliable image-search
 * fallback when Unsplash / Pixabay / Wikimedia Commons don't have a
 * relevant photo. The endpoint requires a vqd token from the search
 * landing page first — same dance every browser does.
 *
 * We follow the standard two-request flow:
 *   1. GET `https://duckduckgo.com/?q=<word>&iax=images&ia=images`
 *      and extract `vqd='<token>'` from the response HTML.
 *   2. GET `https://duckduckgo.com/i.js?q=<word>&vqd=<token>` which
 *      returns `{ results: [{ image, thumbnail }] }`.
 *
 * If the vqd extraction fails (DDG sometimes A/B tests markup), we
 * silently bail and let other image sources cover.
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

    const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1`;
    const data = await fetchJson<DdgResults>(apiUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Referer: 'https://duckduckgo.com/',
      },
    });
    const first = data?.results?.[0];
    const url = first?.image || first?.thumbnail;
    if (!url) return {};
    return { imageUrl: url };
  },
};
