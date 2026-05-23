/**
 * Collins English Dictionary scraper — VIP source.
 *
 * Pattern based on `GreatestCapacity/collins_dict` and the `vuhoangthaiduong`
 * gist. Collins ships COBUILD-style definitions ("If something is X, …")
 * and corpus-derived examples that complement the Oxford / Cambridge
 * style.
 *
 * Markup verified 2026-04:
 *   - `<span class="def">` definitions
 *   - `<div class="cit type-example">` example sentences
 *   - `<span class="pron type-">` IPA
 *   - `<a class="hwd_sound type-" data-src-mp3="…">` audio
 *
 * IMPORTANT: Collins sits behind Cloudflare bot protection and returns
 * 403 to non-browser clients. The extension service worker uses the
 * browser's real network stack with cookies and can succeed where a
 * Node-side audit can't. If a 403 happens in production we degrade
 * silently — Cambridge / Oxford / Longman cover the same definition
 * fields.
 */

import { fetchHtml, resolveUrl } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://www.collinsdictionary.com';

export const collinsSource: EnrichmentSource = {
  id: 'collins',
  label: 'Collins',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
    const url = `${BASE}/dictionary/english/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    const phons = extractByClass(html, 'pron', 'span').map(stripHtml);
    if (phons.length) {
      const raw = phons[0].replace(/^\/+|\/+$/g, '').trim();
      if (raw) partial.phonetic = `/${raw}/`;
    }

    // Audio: data-src-mp3 attribute on any tag.
    const audio: Array<{ url: string; accent?: string }> = [];
    const audioRe = /\bdata-src-mp3\s*=\s*["']([^"']+\.mp3[^"']*)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = audioRe.exec(html)) && audio.length < 4) {
      const u = resolveUrl(BASE, m[1]);
      // Collins ships a single neutral pronunciation per word on most
      // entries so we don't tag accent unless filename hints at it.
      const accent = /am_/i.test(m[1]) ? 'US' : /br_/i.test(m[1]) ? 'UK' : undefined;
      if (!audio.some((a) => a.url === u)) audio.push({ url: u, accent });
    }
    if (audio.length) partial.audio = audio;

    // Definitions: `<div class="def">` (Collins puts them in divs).
    const defs = [
      ...extractByClass(html, 'def', 'div'),
      ...extractByClass(html, 'def', 'span'),
    ]
      .map(stripHtml)
      .filter((s) => s.length > 8);
    if (defs.length) partial.definitions = Array.from(new Set(defs)).slice(0, 4);

    // Examples: `<div class="cit type-example">` (cit = citation).
    const examples = extractByClass(html, 'type-example', 'div')
      .map(stripHtml)
      .filter((s) => s.length > 8 && s.length < 220);
    if (examples.length) {
      partial.examples = examples.slice(0, 4).map((text) => ({ text }));
    }

    return partial;
  },
};
