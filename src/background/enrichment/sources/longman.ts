/**
 * Longman Dictionary of Contemporary English scraper — VIP source.
 *
 * `ldoceonline.com`. Definitions written using a 2 000-word "Defining
 * Vocabulary" — the easiest to read definitions of any major learner's
 * dictionary, ideal for B1-B2 learners.
 *
 * Markup verified 2026-04:
 *   - `<span class="DEF">` definitions
 *   - `<span class="EXAMPLE">` examples
 *   - `<span class="PRON">/bɪɡ/</span>` IPA
 *   - `<span class="speaker brefile fa fa-volume-up" data-src-mp3="…">` audio
 *   - `<span class="COLLO">` collocation flag
 */

import { fetchHtml, resolveUrl } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type {
  EnrichmentSource,
  FrequencyEvidence,
  SenseRelationGroup,
  SourcePartial,
} from '../types';

const BASE = 'https://www.ldoceonline.com';

function cleanUnique(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = stripHtml(value).replace(/\s+/g, ' ').trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length === limit) break;
  }
  return result;
}

export function extractLongmanFrequency(html: string): FrequencyEvidence[] {
  const evidence: FrequencyEvidence[] = [];
  const seen = new Set<string>();

  for (const text of cleanUnique(extractByClass(html, 'FREQ', 'span'), 12)) {
    for (const match of text.toUpperCase().matchAll(/\b([SW])([1-3])\b/g)) {
      const band = `${match[1]}${match[2]}`;
      if (seen.has(band)) continue;
      seen.add(band);
      evidence.push({
        scale: match[1] === 'S' ? 'longman-spoken' : 'longman-written',
        value: band,
        corpus: 'LDOCE',
      });
      if (evidence.length === 6) return evidence;
    }
  }

  return evidence;
}

export function extractLongmanRelationGroups(html: string, token = ''): SenseRelationGroup[] {
  const groups: SenseRelationGroup[] = [];
  const seen = new Set<string>();
  const normalizedToken = token.trim().toLocaleLowerCase();

  // A ThesBox is one conceptual group. Its Exponent children are the
  // alternatives within that concept, not separate senses.
  for (const box of extractByClass(html, 'ThesBox')) {
    const exponents = extractByClass(box, 'Exponent');
    const terms = cleanUnique(
      exponents
        .flatMap((exponent) => extractByClass(exponent, 'EXP', 'span'))
        .flatMap((term) => {
          const clean = stripHtml(term).trim();
          return /^[\p{L}-]+(?:\/[\p{L}-]+)+$/u.test(clean) ? clean.split('/') : [clean];
        }),
      12,
    ).filter((term) => term.toLocaleLowerCase() !== normalizedToken);
    const guide = exponents
      .flatMap((exponent) => cleanUnique(extractByClass(exponent, 'DEF', 'span'), 1))
      .find(Boolean);
    const example = exponents
      .flatMap((exponent) => cleanUnique(extractByClass(exponent, 'EXAMPLE', 'span'), 1))
      .find(Boolean);
    if (!terms.length) continue;

    const key = [guide ?? '', ...terms, example ?? ''].join('\u0000').toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({
      ...(guide ? { guide } : {}),
      ...(example ? { example } : {}),
      synonyms: terms,
    });
    if (groups.length === 6) break;
  }

  return groups;
}

export function extractLongmanCollocations(html: string): string[] {
  const boxes = extractByClass(html, 'ColloBox');
  if (boxes.length) {
    return cleanUnique(
      boxes.flatMap((box) => extractByClass(box, 'COLLOC', 'span')),
      40,
    ).filter((value) => value.length < 60).slice(0, 10);
  }

  return cleanUnique(extractByClass(html, 'COLLO', 'span'), 40)
    .filter((value) => value.length < 60)
    .slice(0, 10);
}

export function extractLongmanQuality(html: string, token = ''): Pick<
  SourcePartial,
  'definitions' | 'examples' | 'collocations' | 'frequencyEvidence' | 'relationGroups'
> {
  const supplementalBoxes = [
    ...extractByClass(html, 'ThesBox'),
    ...extractByClass(html, 'ColloBox'),
  ];
  const entryHtml = supplementalBoxes.reduce((page, box) => page.replace(box, ''), html);
  const result: ReturnType<typeof extractLongmanQuality> = {};

  const definitions = cleanUnique(extractByClass(entryHtml, 'DEF', 'span'), 20)
    .filter((value) => value.length > 6)
    .slice(0, 4);
  if (definitions.length) result.definitions = definitions;

  const examples = cleanUnique(extractByClass(entryHtml, 'EXAMPLE', 'span'), 20)
    .filter((value) => value.length > 8 && value.length < 220)
    .slice(0, 4);
  if (examples.length) result.examples = examples.map((text) => ({ text }));

  const collocations = extractLongmanCollocations(html);
  if (collocations.length) result.collocations = collocations;

  const frequencyEvidence = extractLongmanFrequency(html);
  if (frequencyEvidence.length) result.frequencyEvidence = frequencyEvidence;

  const relationGroups = extractLongmanRelationGroups(html, token);
  if (relationGroups.length) result.relationGroups = relationGroups;

  return result;
}

export const longmanSource: EnrichmentSource = {
  id: 'longman',
  label: 'Longman',
  async enrich(token, ctx): Promise<SourcePartial> {
    const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
    const url = `${BASE}/dictionary/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    const phons = extractByClass(html, 'PRON', 'span').map(stripHtml);
    if (phons.length) {
      const raw = phons[0].replace(/^\/+|\/+$/g, '').trim();
      if (raw) partial.phonetic = `/${raw}/`;
    }

    // Audio: any element with data-src-mp3.
    const audio: Array<{ url: string; accent?: string }> = [];
    const audioRe = /\bdata-src-mp3\s*=\s*["']([^"']+\.mp3[^"']*)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = audioRe.exec(html)) && audio.length < 4) {
      if (/\/exaProns\//i.test(m[1])) continue;
      const fix = resolveUrl(BASE, m[1]);
      const accent = /ameProns|amefile|_us_|\/us\//i.test(m[1]) ? 'US' : 'UK';
      if (!audio.some((a) => a.url === fix)) audio.push({ url: fix, accent });
    }
    if (audio.length) partial.audio = audio;

    Object.assign(partial, extractLongmanQuality(html, token));

    return partial;
  },
};
