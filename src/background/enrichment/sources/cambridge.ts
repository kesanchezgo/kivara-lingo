/**
 * Cambridge Dictionary scraper — VIP source.
 *
 * Scrape pattern based on `Carapacik/cambridge-dictionary-scraper` and
 * `chenelias/cambridge-dictionary-api`. We hit the bilingual EN-ES page
 * when the user is learning English from Spanish (best of both worlds —
 * EN definitions + ES translations) and fall back to the monolingual
 * EN-EN page when the bilingual one 404s.
 *
 * Markup conventions verified against live HTML 2026-04:
 *   - `<span class="ipa dipa">/bɪɡ/</span>`           IPA
 *   - `<source type="audio/mpeg" src="...uk_pron.mp3">` UK audio
 *   - `<source type="audio/mpeg" src="...us_pron.mp3">` US audio
 *   - `<div class="def ddef_d">` definition
 *   - `<span class="trans dtrans">grande</span>`     EN→ES translation
 *   - `<div class="examp dexamp">` example sentences
 *   - `<a class="dictlink" href="…">` collocation links (in collocations
 *      block when the page has one)
 *
 * Returns a partial with: definitions, translations, examples,
 * collocations, IPA, audio.
 */

import { fetchHtml, resolveUrl } from '../fetcher';
import {
  extractByClass,
  extractAttrByClass,
  extractAnchorsByClass,
  stripHtml,
} from '../html-utils';
import type {
  EnrichmentContext,
  EnrichmentSource,
  SenseRelationGroup,
  SourcePartial,
} from '../types';

const BASE = 'https://dictionary.cambridge.org';

function slugFor(token: string): string {
  return encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
}

function urlFor(token: string, sourceLang: string, targetLang: string): string {
  const slug = slugFor(token);
  // Bilingual EN→ES has the most useful data when both langs are EN/ES.
  const src = sourceLang.slice(0, 2);
  const tgt = targetLang.slice(0, 2);
  if (src === 'en' && tgt === 'es') return `${BASE}/dictionary/english-spanish/${slug}`;
  if (src === 'en') return `${BASE}/dictionary/english/${slug}`;
  if (src === 'es' && tgt === 'en') return `${BASE}/dictionary/spanish-english/${slug}`;
  return `${BASE}/dictionary/english/${slug}`;
}

function cleanRelationText(value: string): string {
  return stripHtml(value)
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueTerms(values: string[], headword: string, limit: number): string[] {
  const seen = new Set<string>();
  const normalizedHeadword = headword.toLocaleLowerCase();
  const terms: string[] = [];

  for (const value of values) {
    const term = cleanRelationText(value);
    const normalized = term.toLocaleLowerCase();
    if (!term || term.length > 60 || normalized === normalizedHeadword || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(term);
    if (terms.length === limit) break;
  }

  return terms;
}

/** Parse Cambridge Thesaurus relations without flattening distinct senses. */
export function parseCambridgeThesaurus(html: string, token: string): SenseRelationGroup[] {
  const wanted = cleanRelationText(token).toLocaleLowerCase();
  const titleBlock = extractByClass(html, 'di-title', 'div')[0] ?? '';
  const pageHeadword = [
    ...extractByClass(titleBlock, 'ttn', 'b'),
    ...extractByClass(titleBlock, 'dhw', 'span'),
  ].map(cleanRelationText).find(Boolean);

  // Thesaurus fallback pages may contain nearby entries. Unlike dictionary
  // lookups, relations are accepted only for an exact headword match.
  if (!wanted || !pageHeadword || pageHeadword.toLocaleLowerCase() !== wanted) return [];

  const groups: SenseRelationGroup[] = [];
  const seenGroups = new Set<string>();
  for (const senseHtml of extractByClass(html, 'dsense', 'div')) {
    const synonyms = uniqueTerms(extractByClass(senseHtml, 'synonym', 'span'), pageHeadword, 6);
    const antonyms = uniqueTerms(extractByClass(senseHtml, 'opposite', 'span'), pageHeadword, 4);
    if (!synonyms.length && !antonyms.length) continue;

    const guide = extractByClass(senseHtml, 'dsense_gw')
      .map(cleanRelationText)
      .find(Boolean);
    const example = extractByClass(senseHtml, 'deg')
      .map(cleanRelationText)
      .find((value) => value.length <= 220);

    const key = `${guide ?? ''}\u0000${example ?? ''}\u0000${synonyms.join('\u0000')}\u0000${antonyms.join('\u0000')}`.toLowerCase();
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    groups.push({
      ...(guide ? { guide } : {}),
      ...(example ? { example } : {}),
      ...(synonyms.length ? { synonyms } : {}),
      ...(antonyms.length ? { antonyms } : {}),
    });
    if (groups.length === 16) break;
  }

  return groups;
}

export const cambridgeSource: EnrichmentSource = {
  id: 'cambridge',
  label: 'Cambridge',
  async enrich(token, ctx): Promise<SourcePartial> {
    const sourceLang = ctx.sourceLang || 'en';
    const requestOptions = {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    };
    const dictionaryRequest = fetchHtml(
      urlFor(token, sourceLang, ctx.targetLang || 'es'),
      requestOptions,
    );
    const thesaurusRequest = sourceLang.slice(0, 2) === 'en'
      ? fetchHtml(`${BASE}/thesaurus/${slugFor(token)}`, requestOptions).catch(() => null)
      : Promise.resolve(null);
    const html = await dictionaryRequest;
    if (!html) return {};

    // Guard against Cambridge's "no exact match" landing page, which
    // still returns HTTP 200 but renders an unrelated nearby entry
    // (e.g. querying "big girl" lands on "bear", and stray IPA blocks
    // like "party animal" leak into multi-word queries). We only trust
    // the scrape when the page's headword block (`di-title`) matches
    // the queried token — otherwise we'd poison the merge with another
    // word's IPA / definition.
    const diTitle = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bdi-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
    const headword = diTitle ? stripHtml(diTitle[1]).toLowerCase().trim() : '';
    const wanted = token.trim().toLowerCase();
    if (!headword || (headword !== wanted && !headword.includes(wanted) && !wanted.includes(headword))) {
      return {};
    }

    const partial: SourcePartial = {};

    // IPA — must belong to the headword, not a stray nearby entry.
    // The headword's pronunciation always renders within ~1.3k chars
    // of the `di-title`; an IPA span much farther away (e.g. 16k chars
    // for "kick the bucket") belongs to an unrelated "see also" entry
    // like "party animal", so we ignore it.
    const diIdxForIpa = html.search(/class\s*=\s*["'][^"']*\bdi-title\b/i);
    const afterDi = diIdxForIpa >= 0 ? html.slice(diIdxForIpa) : html;
    const firstIpaOffset = afterDi.search(/class\s*=\s*["'][^"']*\bipa\b/i);
    if (firstIpaOffset >= 0 && firstIpaOffset < 3000) {
      const ipas = extractByClass(afterDi, 'ipa', 'span').map(stripHtml);
      if (ipas.length) partial.phonetic = `/${ipas[0].replace(/^\/+|\/+$/g, '')}/`;
    }

    // Audio — UK + US `<source>` elements. Cambridge usually ships
    // `uk_pron.mp3` and `us_pron.mp3` paths.
    const audioPaths = extractAttrByClass(html, '', 'src', 'source')
      .filter((p) => /\.mp3(\?|$)/i.test(p))
      .filter((p) => /pron|speaker|amp3/i.test(p));
    const audio: Array<{ url: string; accent?: string }> = [];
    for (const p of audioPaths) {
      const abs = resolveUrl(BASE, p);
      const accent = /us_pron|\/us\//i.test(p) ? 'US' : /uk_pron|\/uk\//i.test(p) ? 'UK' : undefined;
      // De-duplicate: same accent appearing twice (one per dialect block).
      if (!audio.some((a) => a.url === abs)) audio.push({ url: abs, accent });
    }
    if (audio.length) partial.audio = audio.slice(0, 4);

    // Definitions: `<div class="def ddef_d">`.
    const definitions = extractByClass(html, 'ddef_d', 'div')
      .map(stripHtml)
      .map((s) => s.replace(/:\s*$/, ''))
      .filter((s) => s.length > 6);
    if (definitions.length) partial.definitions = definitions.slice(0, 4);

    // Translations: `<span class="trans dtrans">…</span>` (only present
    // on the bilingual page, where it ships ES translations).
    const translations = extractByClass(html, 'dtrans', 'span')
      .map(stripHtml)
      .filter((s) => s && s.length < 80);
    if (translations.length) {
      partial.translations = Array.from(new Set(translations)).slice(0, 6);
    }

    // Examples: `<div class="examp dexamp">`.
    const examples = extractByClass(html, 'dexamp', 'div')
      .map(stripHtml)
      .filter((s) => s.length > 8 && s.length < 220);
    if (examples.length) {
      partial.examples = examples.slice(0, 4).map((text) => ({ text }));
    }

    // Collocations: anchors inside the `daccord_b` collocation block.
    // Cambridge surfaces these as clickable links to other entries.
    const collocAnchors = extractAnchorsByClass(html, 'dictlink');
    const collocations = collocAnchors
      .map((a) => a.text)
      .filter((s) => s && s.split(/\s+/).length >= 2 && s.length < 60);
    if (collocations.length) {
      partial.collocations = Array.from(new Set(collocations)).slice(0, 10);
    }

    const thesaurusHtml = await thesaurusRequest;
    if (thesaurusHtml) {
      const relationGroups = parseCambridgeThesaurus(thesaurusHtml, token);
      if (relationGroups.length) partial.relationGroups = relationGroups;
    }

    return partial;
  },
};
