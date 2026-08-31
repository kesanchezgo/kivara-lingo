/**
 * Dictionary.com English dictionary scraper.
 *
 * Replaces Collins, whose pages are no longer reachable from an MV3 service
 * worker because Cloudflare serves an interactive challenge. Dictionary.com
 * exposes comparable editorial definitions, IPA, pronunciation audio and
 * examples in static HTML, including strong phrasal-verb coverage.
 */

import { fetchHtml, resolveUrl } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://www.dictionary.com';
const AUDIO_BASE = 'https://audio.dictionary.com/';

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return match?.[1] ?? null;
}

export const dictionaryComSource: EnrichmentSource = {
  id: 'dictionaryCom',
  label: 'Dictionary.com',
  async enrich(token, ctx): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2).toLowerCase() !== 'en') return {};

    const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
    if (!slug) return {};
    const url = `${BASE}/browse/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    const phonetic = extractByClass(html, 'txt-ipa', 'span')
      .map(stripHtml)
      .map((value) => value.replace(/^\/\s*|\s*\/$/g, '').trim())
      .find(Boolean);
    if (phonetic) partial.phonetic = `/${phonetic}/`;

    const audioButton = /<button\b[^>]*\bcommon-btn-headword-audio\b[^>]*>/i.exec(html)?.[0];
    if (audioButton) {
      const path = attribute(audioButton, 'data-audiosrc');
      const origin = attribute(audioButton, 'data-audioorigin');
      const audioHeadword = token.trim().toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9-]/g, '');
      // Dictionary.com may render a generic fallback entry when a phrase has
      // no headword page. Never attach that unrelated entry's pronunciation.
      const belongsToHeadword = path && audioHeadword &&
        new RegExp(`(?:^|[/_-])${audioHeadword}(?:[/_.-]|$)`, 'i').test(path);
      if (path && belongsToHeadword) {
        const audioBase = origin ? `${origin.replace(/\/$/, '')}/` : AUDIO_BASE;
        partial.audio = [{ url: resolveUrl(audioBase, path), accent: 'US' }];
      }
    }

    const definitions = unique(extractByClass(html, 'txt-variant-label-short', 'p')
      .map(stripHtml)
      .map((value) => value.replace(/^\s*\d+[a-z]?\.\s*/i, '').trim())
      .filter((value) => value.length > 8 && value.length < 400));
    if (definitions.length) partial.definitions = definitions.slice(0, 6);

    const examples = unique(extractByClass(html, 'txt-example', 'p')
      .map(stripHtml)
      .filter((value) => value.length > 8 && value.length < 260));
    if (examples.length) {
      partial.examples = examples.slice(0, 5).map((text) => ({ text }));
    }

    return partial;
  },
};
