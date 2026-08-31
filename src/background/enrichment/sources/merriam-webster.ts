/**
 * Merriam-Webster Learner's Dictionary scraper — VIP source.
 *
 * `merriam-webster.com`. American English authority with detailed
 * etymology and definitions adapted to ESL learners.
 *
 * Markup verified 2026-04:
 *   - `<span class="dtText">` definition body
 *   - `<span class="ex-sent">` example sentence
 *   - `<span class="prs">` IPA
 *   - `<a class="play-pron-v2" data-file="…" data-dir="…">` audio
 *   - `<p class="et">` etymology
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://www.merriam-webster.com';

function audioUrl(file: string, dir: string): string {
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${dir}/${file}.mp3`;
}

export const merriamWebsterSource: EnrichmentSource = {
  id: 'merriamWebster',
  label: 'M-W',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, ' '));
    const url = `${BASE}/dictionary/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      credentials: 'include',
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    const phons = extractByClass(html, 'mw', 'span').map(stripHtml);
    if (phons.length) {
      const raw = phons[0].replace(/^\\|\\$/g, '').trim();
      if (raw) partial.phonetic = `/${raw}/`;
    }

    // Audio: `data-file="big01" data-dir="b"` on the play button.
    const audio: Array<{ url: string; accent?: string }> = [];
    const audioRe = /\bdata-file\s*=\s*["']([^"']+)["'][^>]*\bdata-dir\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = audioRe.exec(html)) && audio.length < 2) {
      audio.push({ url: audioUrl(m[1], m[2]), accent: 'US' });
    }
    if (audio.length) partial.audio = audio;

    const defs = extractByClass(html, 'dtText', 'span')
      .map(stripHtml)
      // M-W prefixes definitions with ": " — strip.
      .map((s) => s.replace(/^[\s:]+/, ''))
      .filter((s) => s.length > 6);
    if (defs.length) partial.definitions = defs.slice(0, 4);

    const examples = extractByClass(html, 'ex-sent', 'span')
      .map(stripHtml)
      .filter((s) => s.length > 8 && s.length < 220);
    if (examples.length) {
      partial.examples = examples.slice(0, 4).map((text) => ({ text }));
    }

    // Etymology paragraph.
    const ety = extractByClass(html, 'et', 'p').map(stripHtml);
    if (ety.length) partial.etymology = ety[0].slice(0, 400);

    return partial;
  },
};
