/**
 * Merriam-Webster Thesaurus scraper — VIP source.
 *
 * `merriam-webster.com/thesaurus/<slug>`. Second editorial thesaurus
 * authority alongside Cambridge: sense-scoped synonym AND antonym groups
 * with per-sense glosses, examples and an "as in" cross-reference
 * headword that disambiguates the sense without extra rules.
 *
 * Selectors verified against the real MV3 fixture captured 2026-08-29
 * (`docs/reports/runtime/fixtures/mw-thesaurus/*.html`):
 *   - `<div class="sense ...">`           one sense block
 *   - `<div class="as-in-word">`          "as in <em>to manage</em>" guide
 *   - `<span class="dt ...">`             per-sense gloss
 *   - `... ex-sent ...`                   usage example sentence
 *   - `<div id="sim-list-scored-content-N-M">` synonym list for sense N
 *   - `<div id="opp-list-scored-content-N-M">` antonym list for sense N
 *   - `<span class="syl">word</span>`     one relation word inside a list
 *
 * The sense index N is the ordinal of the `sense` block in the document,
 * which matches the N used by the list ids (verified: run → 21 senses,
 * sim/opp lists numbered 1-1 .. 21-x). Antonym lists are optional; when a
 * sense has none, its opp list is absent and we publish only synonyms.
 */

import { fetchHtml } from '../fetcher';
import { stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://www.merriam-webster.com';

const MAX_SENSE_GROUPS = 16;
const MAX_RELATIONS_PER_GROUP = 12;
const MAX_EXAMPLES = 2;

/**
 * Slice one `<div id="thesaurus-entry-N-M">…</div>` container (balanced
 * on divs). Each container holds exactly ONE sense block plus its own
 * `sim-list-scored-content-N-M` / `opp-list-scored-content-N-M` lists.
 */
function extractEntryBlocks(html: string): string[] {
  const out: string[] = [];
  const marker = /id="thesaurus-entry-(\d+)-(\d+)"/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = marker.exec(html)) && out.length < MAX_SENSE_GROUPS) {
    const id = m[0];
    if (seen.has(id)) continue; // duplicate id occurrences (nav + entry)
    seen.add(id);
    const divStart = html.lastIndexOf('<div', m.index);
    if (divStart === -1) continue;
    let depth = 0;
    const tagRe = /<\/?div\b/gi;
    tagRe.lastIndex = divStart;
    let tag: RegExpExecArray | null;
    while ((tag = tagRe.exec(html))) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        out.push(html.slice(divStart, tag.index + tag[0].length));
        break;
      }
    }
  }
  return out;
}

/** Extract every relation word (`<span class="syl">…</span>`) from a block.
 * MW's relevance sort carries noise high: for `piece of cake` the raw
 * order is breeze, picnic, NOTHING, cream puff, cake, roses… — filler
 * (nothing, cake) and drift (roses, cream puff) ride near the top, so
 * order alone cannot separate head from tail. The parser drops three
 * closed noise classes up front: the headword's own literal components
 * (cake/piece — the literal sense leaking in), empty quantifiers
 * (nothing/something/anything — never an equivalent), and floral drift
 * (roses/rose — MW's association engine pollinates every easy-thing
 * list with it). The merger's sense gate and figurative-antonym bridge
 * handle the rest downstream. Verified live 2026-09-10: `piece of
 * cake` vip syn ended with roses/nothing.
 */
function extractListWords(block: string, token = ''): string[] {
  const out: string[] = [];
  const headwords = new Set(token.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const re = /class="syl">([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) && out.length < MAX_RELATIONS_PER_GROUP) {
    const word = stripHtml(m[1]).trim();
    if (!word || word.length > 40 || out.includes(word)) continue;
    const low = word.toLowerCase();
    // The headword's own literal components are the literal sense
    // leaking in (cake/piece for `piece of cake`); empty quantifiers
    // (nothing) are never an equivalent of anything; floral drift
    // (roses) is MW's association engine, not a synonym. All three ride
    // high in MW's relevance sort, so order alone cannot catch them.
    if (headwords.has(low)) continue;
    if (low === 'nothing' || low === 'something' || low === 'anything') continue;
    if (low === 'rose' || low === 'roses') continue;
    out.push(word);
  }
  return out;
}

export const merriamWebsterThesaurusSource: EnrichmentSource = {
  id: 'merriamWebsterThesaurus',
  label: 'M-W Thesaurus',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};

    const slug = encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, ' '));
    const html = await fetchHtml(`${BASE}/thesaurus/${slug}`, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      credentials: 'include',
    });
    if (!html) return {};

    // Slice the entry container so the search sidebar and "Browse Nearby
    // Words" footers cannot leak relation words into the sense groups.
    // The footer anchor can appear BEFORE the container in the document
    // (verified in the fixture), so the end anchor is only honoured when
    // it sits after the start.
    const containerStart = html.indexOf('entry-word-section-container');
    let body = html;
    if (containerStart !== -1) {
      const containerEnd = html.indexOf('Example Sentences', containerStart);
      body = containerEnd !== -1 ? html.slice(containerStart, containerEnd) : html.slice(containerStart);
    }

    const partial: SourcePartial = {};
    const groups: Array<{
      guide?: string;
      definition?: string;
      example?: string;
      synonyms?: string[];
      antonyms?: string[];
    }> = [];

    for (const block of extractEntryBlocks(body)) {
      const guideMatch = block.match(/class="as-in-word">\s*as in\s*<em>([\s\S]*?)<\/em>/i);
      const guide = guideMatch ? stripHtml(guideMatch[1]).trim() : undefined;

      const glossMatch = block.match(/class="dt\s[^"]*"[^>]*>([\s\S]*?)(?:<\/span>|<span class="sub-content-thread)/i);
      const definition = glossMatch ? stripHtml(glossMatch[1]).trim() : undefined;

      const exampleMatch = block.match(/class="d-block thread-anchor-content[^"]*">([\s\S]*?)<\/span>/i);
      const example = exampleMatch ? stripHtml(exampleMatch[1]).trim() : undefined;

      // Each entry block carries its own sim/opp lists; extract the words
      // from the matching sub-lists so cross-sense leakage is impossible.
      // The token rides along so the parser can drop the headword's own
      // literal components and empty quantifiers up front.
      const simBlock = block.match(/<div id="sim-list-scored-content-[^"]*"[\s\S]*?<\/ul>/i);
      const oppBlock = block.match(/<div id="opp-list-scored-content-[^"]*"[\s\S]*?<\/ul>/i);
      const synonyms = simBlock ? extractListWords(simBlock[0], token) : [];
      const antonyms = oppBlock ? extractListWords(oppBlock[0], token) : [];

      if (synonyms.length || antonyms.length) {
        groups.push({
          ...(guide ? { guide } : {}),
          ...(definition ? { definition } : {}),
          ...(example && example.length < 220 ? { example } : {}),
          ...(synonyms.length ? { synonyms } : {}),
          ...(antonyms.length ? { antonyms } : {}),
        });
      }
    }

    // Sense-scoped examples are a bonus; cap to keep the field lean.
    const examples: Array<{ text: string }> = [];
    for (const group of groups) {
      if (!group.example) continue;
      if (examples.some((existing) => existing.text === group.example)) continue;
      examples.push({ text: group.example });
      if (examples.length >= MAX_EXAMPLES) break;
    }

    if (groups.length) partial.relationGroups = groups;
    if (examples.length) partial.examples = examples;
    return partial;
  },
};
