/**
 * Pixabay search scraper — VIP image source.
 *
 * No API key. We hit `pixabay.com/images/search/<query>/` and grab the
 * first thumbnail. Pixabay license is CC0 (free including commercial).
 */

import { fetchHtml } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

export const pixabaySource: EnrichmentSource = {
  id: 'pixabay',
  label: 'Pixabay',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim());
    const url = `https://pixabay.com/images/search/${slug}/`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    // Pixabay CDN: cdn.pixabay.com/photo/YYYY/MM/DD/HH/MM/<slug>-<id>_640.jpg
    const re = /https:\/\/cdn\.pixabay\.com\/photo\/[^"'\s)]+_(?:640|960|1280)\.(?:jpg|png|webp)/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && found.length < 4) {
      if (!found.includes(m[0])) found.push(m[0]);
    }
    if (!found.length) return {};
    return { imageUrl: found[0] };
  },
};
