/**
 * Pixabay — VIP image source.
 *
 * Two-mode: when `vip.pixabayApiKey` is set we hit the official API,
 * otherwise we scrape `pixabay.com/images/search/<query>/`. Scraping
 * works (curl from any browser-like UA returns 200 with ~280 cdn URLs
 * embedded in the HTML), but the official API is more reliable and
 * higher-quality.
 *
 * Free API key at https://pixabay.com/api/docs/ — 100 requests/minute,
 * no credit card required.
 *
 * Pixabay license is the Pixabay Content License: free for commercial
 * use, no attribution required.
 */

import { fetchHtml, fetchJson } from '../fetcher';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

interface PixabayApiResponse {
  hits?: Array<{
    webformatURL?: string;
    largeImageURL?: string;
    previewURL?: string;
  }>;
}

interface PixabayContext extends EnrichmentContext {
  pixabayApiKey?: string;
}

export const pixabaySource: EnrichmentSource = {
  id: 'pixabay',
  label: 'Pixabay',
  async enrich(token, ctx): Promise<SourcePartial> {
    const apiKey = (ctx as PixabayContext).pixabayApiKey;
    const q = encodeURIComponent(token.trim());

    // ─ Path A: official API when a key is set ──────────────────────
    if (apiKey) {
      const url =
        `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}` +
        `&q=${q}&image_type=photo&per_page=5&safesearch=true`;
      const data = await fetchJson<PixabayApiResponse>(url, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
      });
      const hit = data?.hits?.[0];
      const imageUrl =
        hit?.largeImageURL || hit?.webformatURL || hit?.previewURL;
      if (imageUrl) return { imageUrl };
      // fall through to scrape if API call failed.
    }

    // ─ Path B: HTML scrape (no key) ────────────────────────────────
    const url = `https://pixabay.com/images/search/${q}/`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};
    // Pixabay CDN: cdn.pixabay.com/photo/YYYY/MM/.../<slug>-<id>_640.jpg
    const re = /https:\/\/cdn\.pixabay\.com\/photo\/[^"'\s)]+_(?:640|960|1280)\.(?:jpg|png|webp)/g;
    const m = re.exec(html);
    if (!m) return {};
    return { imageUrl: m[0] };
  },
};
