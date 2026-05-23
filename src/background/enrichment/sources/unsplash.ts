/**
 * Unsplash — VIP image source via the official API (BYOK).
 *
 * Unsplash's public website (`unsplash.com/s/photos/...`) moved behind
 * an Anubis JS-challenge gate in 2025 that blocks every server-side /
 * SW fetch. The only viable way to use Unsplash is the developer API:
 *
 *   GET https://api.unsplash.com/search/photos?query=<word>&per_page=5
 *   Authorization: Client-ID <access_key>
 *
 * The key is FREE (no credit card) at https://unsplash.com/developers.
 * Demo tier ships 50 requests/hour — far above what any single user
 * needs for vocabulary cards.
 *
 * If `vip.unsplashAccessKey` is empty we return `{}` so the source is
 * effectively inactive — Bing / Openverse / Wikimedia / DDG cover the
 * image slot.
 */

import { fetchWithTimeout } from '../fetcher';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

interface UnsplashResult {
  urls?: {
    regular?: string;
    small?: string;
    thumb?: string;
  };
}

interface UnsplashResponse {
  results?: UnsplashResult[];
}

interface UnsplashContext extends EnrichmentContext {
  unsplashAccessKey?: string;
}

export const unsplashSource: EnrichmentSource = {
  id: 'unsplash',
  label: 'Unsplash',
  async enrich(token, ctx): Promise<SourcePartial> {
    const accessKey = (ctx as UnsplashContext).unsplashAccessKey;
    if (!accessKey) return {};

    const q = encodeURIComponent(token.trim());
    const url = `https://api.unsplash.com/search/photos?query=${q}&per_page=5&orientation=landscape`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        Accept: 'application/json',
        'Accept-Version': 'v1',
      },
    });
    if (!res) return {};
    let data: UnsplashResponse;
    try {
      data = (await res.json()) as UnsplashResponse;
    } catch {
      return {};
    }
    const first = data.results?.[0];
    const imageUrl = first?.urls?.regular || first?.urls?.small || first?.urls?.thumb;
    if (!imageUrl) return {};
    return { imageUrl };
  },
};
