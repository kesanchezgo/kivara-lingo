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
import type { EnrichmentContext, EnrichmentSource, ImageCandidate, SourcePartial } from '../types';

interface PixabayApiResponse {
  hits?: Array<{
    webformatURL?: string;
    largeImageURL?: string;
    previewURL?: string;
    tags?: string;
    pageURL?: string;
  }>;
}

interface PixabayBootstrapResponse {
  page?: {
    results?: Array<{
      mediaType?: string;
      sources?: Record<string, string>;
    }>;
  };
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
      // Ranked candidates, not a single hero URL: the merger's semantic
      // ranking (bad-subject, language, idiom gates) decides what
      // publishes. A single `imageUrl` bypasses every gate the probe
      // verified — same fix as Unsplash.
      const candidates: ImageCandidate[] = [];
      for (const hit of data?.hits ?? []) {
        const imageUrl = hit?.largeImageURL || hit?.webformatURL || hit?.previewURL;
        if (!imageUrl) continue;
        candidates.push({
          url: imageUrl,
          ...(hit?.tags ? { title: hit.tags } : {}),
          ...(hit?.pageURL ? { sourcePageUrl: hit.pageURL } : {}),
        });
        if (candidates.length >= 5) break;
      }
      if (candidates.length) return { imageCandidates: candidates };
      // fall through to scrape if API call failed.
    }

    // ─ Path B: public bootstrap scrape (no key) ────────────────────
    // Pixabay's search page exposes the same public results as JSON when the
    // frontend asks for its bootstrap payload. This is still first-party,
    // keyless scraping of the regular search page.
    const url = `https://pixabay.com/images/search/${q}/?pagi=1`;
    const bootstrap = await fetchJson<PixabayBootstrapResponse>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      // Never send the user's browser cookies to a third-party dictionary: a
      // leak of who is browsing what word is worse than a 403.
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'x-bootstrap-cache-miss': '1',
        'x-fetch-bootstrap': '1',
      },
    });
    for (const result of bootstrap?.page?.results ?? []) {
      if (result.mediaType && !['photo', 'illustration', 'vector'].includes(result.mediaType)) continue;
      const sources = Object.values(result.sources ?? {}).filter((value) => /^https:\/\//.test(value));
      const imageUrl = sources.at(-1);
      if (imageUrl) return { imageUrl };
    }

    // ─ Path C: legacy HTML scrape fallback ─────────────────────────
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      // Never send the user's browser cookies to a third-party dictionary: a
      // leak of who is browsing what word is worse than a 403.
      credentials: 'omit',
    });
    if (!html) return {};
    const re = /https:\/\/cdn\.pixabay\.com\/photo\/[^"'\s)]+_(?:640|960|1280)\.(?:jpg|png|webp)/g;
    const m = re.exec(html);
    return m ? { imageUrl: m[0] } : {};
  },
};
