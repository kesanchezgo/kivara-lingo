/**
 * Openverse — CC-licensed image search API.
 *
 * Openverse aggregates Creative Commons + public-domain media from
 * Flickr, Wikimedia Commons, museum archives, etc. and exposes a
 * free public JSON API with no signup needed for low-volume use.
 *
 *   GET https://api.openverse.org/v1/images/?q=<word>&page_size=5
 *
 * Verified live 2026-05 returning JSON shape:
 *   {
 *     result_count: 240,
 *     results: [
 *       {
 *         id, title, url, thumbnail, license, license_version,
 *         license_url, creator, source, ...
 *       }
 *     ]
 *   }
 *
 * Every result is freely usable (CC-BY, CC-BY-SA, CC0, PDM). Perfect
 * standard-tier replacement for Unsplash, which moved behind an
 * Anubis JS-challenge gate that blocks all server-side fetches.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

interface OpenverseResult {
  id?: string;
  url?: string;
  thumbnail?: string;
  title?: string;
  license?: string;
}

interface OpenverseResponse {
  result_count?: number;
  results?: OpenverseResult[];
}

export const openverseSource: EnrichmentSource = {
  id: 'openverse',
  label: 'Openverse',
  async enrich(token, ctx): Promise<SourcePartial> {
    const q = encodeURIComponent(token.trim());
    const url = `https://api.openverse.org/v1/images/?q=${q}&page_size=5&mature=false`;
    const data = await fetchJson<OpenverseResponse>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    const first = data?.results?.[0];
    const imageUrl = first?.url || first?.thumbnail;
    if (!imageUrl) return {};
    return { imageUrl };
  },
};
