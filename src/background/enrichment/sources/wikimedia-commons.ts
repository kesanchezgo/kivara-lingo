/**
 * Wikimedia Commons image search — VIP image source (and a great
 * fallback when Unsplash / Pixabay don't have the niche term).
 *
 * Uses the public Commons API (`commons.wikimedia.org/w/api.php`).
 * No key. Returns CC-BY-SA / CC0 / public-domain images.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

interface SearchResp {
  query?: { search?: Array<{ title?: string }> };
}

interface InfoResp {
  query?: {
    pages?: Record<string, { imageinfo?: Array<{ url?: string; thumburl?: string }> }>;
  };
}

export const wikimediaCommonsSource: EnrichmentSource = {
  id: 'wikimediaCommons',
  label: 'Wikimedia',
  async enrich(token, ctx): Promise<SourcePartial> {
    const t = token.trim();
    if (!t) return {};

    const searchUrl =
      `https://commons.wikimedia.org/w/api.php` +
      `?action=query&list=search&format=json&origin=*` +
      `&srnamespace=6` +
      `&srsearch=${encodeURIComponent(`${t} filetype:bitmap`)}` +
      `&srlimit=4`;
    const search = await fetchJson<SearchResp>(searchUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const titles = (search?.query?.search ?? [])
      .map((r) => r.title ?? '')
      .filter((x) => /\.(jpg|jpeg|png|webp)$/i.test(x))
      .slice(0, 1);
    if (titles.length === 0) return {};

    const infoUrl =
      `https://commons.wikimedia.org/w/api.php` +
      `?action=query&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json&origin=*` +
      `&titles=${encodeURIComponent(titles.join('|'))}`;
    const info = await fetchJson<InfoResp>(infoUrl, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const pages = info?.query?.pages ?? {};
    for (const p of Object.values(pages)) {
      const ii = p?.imageinfo?.[0];
      if (ii?.thumburl) return { imageUrl: ii.thumburl };
      if (ii?.url) return { imageUrl: ii.url };
    }
    return {};
  },
};
