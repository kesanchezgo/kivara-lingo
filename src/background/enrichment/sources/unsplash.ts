/**
 * Unsplash search scraper — VIP image source.
 *
 * No API key. We hit `unsplash.com/s/photos/<query>` and grab the
 * first few `<img>` URLs from the search results page.
 *
 * Unsplash images are CC0-equivalent (Unsplash License) — free for
 * personal and commercial use without attribution.
 */

import { fetchHtml } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

export const unsplashSource: EnrichmentSource = {
  id: 'unsplash',
  label: 'Unsplash',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim());
    const url = `https://unsplash.com/s/photos/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    // Unsplash CDN URLs follow `https://images.unsplash.com/photo-…`.
    // Match the first occurrence with the `?w=400` resize hint.
    const re = /https:\/\/images\.unsplash\.com\/photo-[a-zA-Z0-9-]+(?:\?[^"'\s)]*)?/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && found.length < 4) {
      const u = m[0];
      // Normalize to a 600px-wide variant for fast loads.
      const clean = u.split('?')[0] + '?w=600&q=70';
      if (!found.includes(clean)) found.push(clean);
    }
    if (!found.length) return {};
    return { imageUrl: found[0] };
  },
};
