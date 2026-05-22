/**
 * Ozdic — Oxford Collocations Dictionary mirror — VIP source.
 *
 * `ozdic.com` is the most complete free mirror of the Oxford
 * Collocations Dictionary, structured by part-of-speech and grammatical
 * pattern (ADJ + noun, VERB + noun, PREP, etc.). Each entry ships a
 * JSON tree inside `<script id="__NUXT_DATA__">` (Nuxt 3 hydration
 * payload). We parse that tree and flatten it into a list of
 * collocations like `"perfect excuse"`, `"give an excuse"`,
 * `"excuse for"`.
 *
 * NUXT_DATA format: a flat array where each element is either a
 * primitive value, an inline array of references, or a `{key:refIndex}`
 * object. References are integer indices into the same array. We
 * recursively expand starting at index 0 with a `seen` guard against
 * cycles.
 *
 * Verified live 2026-05.
 */

import { fetchHtml } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

interface OzdicCluster {
  words?: string[];
  example?: string;
}

interface OzdicGroup {
  /** "ADJ.", "VERB + EXCUSE", "PREP.", etc. */
  cat?: string;
  clusters?: OzdicCluster[];
}

interface OzdicCollocSection {
  n?: number;
  gloss?: string;
  groups?: OzdicGroup[];
}

interface OzdicWord {
  word?: string;
  collocations?: OzdicCollocSection[];
}

/**
 * Minimal parser for Nuxt 3 inline payload format. The full client
 * uses devalue.js — we re-implement just the subset that ozdic
 * actually emits (objects, arrays, primitives, ShallowReactive
 * markers).
 */
function parseNuxtData(text: string): unknown {
  let arr: unknown[];
  try {
    arr = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;

  function expand(idx: unknown, seen: Set<number>): unknown {
    if (typeof idx !== 'number') return idx;
    if (seen.has(idx)) return null;
    seen.add(idx);
    const v = arr[idx];
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      // ShallowReactive / Reactive markers: ['ShallowReactive', N]
      if (typeof v[0] === 'string' && v.length === 2) {
        return expand(v[1], new Set(seen));
      }
      return v.map((i) => expand(i, new Set(seen)));
    }
    const out: Record<string, unknown> = {};
    for (const [k, ref] of Object.entries(v as Record<string, unknown>)) {
      out[k] = expand(ref, new Set(seen));
    }
    return out;
  }

  return expand(0, new Set());
}

export const ozdicSource: EnrichmentSource = {
  id: 'ozdic',
  label: 'Oxford Coll.',
  async enrich(token, ctx): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2) !== 'en') return {};
    const slug = encodeURIComponent(token.trim().toLowerCase());
    const url = `https://ozdic.com/word/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    const m = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]+?)<\/script>/i.exec(html);
    if (!m) return {};
    const parsed = parseNuxtData(m[1]) as Record<string, unknown> | null;
    if (!parsed) return {};

    // The data is keyed by `word-<token>`. Multiple POS share the same
    // entry; the structure groups collocations by sense (`gloss`) and
    // pattern category.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (parsed as any)?.data ?? {};
    const wordKey = `word-${token.trim().toLowerCase()}`;
    const word: OzdicWord | undefined = data[wordKey];
    if (!word?.collocations) return {};

    const collocations = new Set<string>();
    const examples: Array<{ text: string }> = [];

    for (const sec of word.collocations) {
      for (const group of sec.groups ?? []) {
        const cat = (group.cat || '').toUpperCase();
        for (const cluster of group.clusters ?? []) {
          for (const w of cluster.words ?? []) {
            // Render the collocation in a natural reading order:
            //   ADJ.        → "<adj> <token>"          (perfect excuse)
            //   VERB + N    → "<verb> <token>"         (give excuse)
            //   N + VERB    → "<token> <verb>"         (excuse arises)
            //   PREP.       → "<token> <prep>"         (excuse for)
            //   QUANT.      → "<quant> of <token>"     (lots of fun)
            //   PHRASES     → cluster word as-is (already a full phrase)
            const phrase = renderCollocation(token, cat, w);
            if (phrase && phrase.length < 60) collocations.add(phrase);
          }
          if (cluster.example && cluster.example.length > 8 && cluster.example.length < 220) {
            examples.push({ text: cluster.example });
          }
        }
      }
    }

    const partial: SourcePartial = {};
    if (collocations.size) {
      partial.collocations = Array.from(collocations).slice(0, 18);
    }
    if (examples.length) partial.examples = examples.slice(0, 6);
    return partial;
  },
};

/**
 * Combine a head token with a collocate word using the OCD pattern
 * category as a hint about the natural order. When the category is
 * unknown we fall back to "<token> <word>" which is the most common
 * reading.
 */
function renderCollocation(token: string, cat: string, word: string): string {
  const t = token.trim().toLowerCase();
  const w = word.trim().toLowerCase();
  if (!w) return '';
  // Already a phrase containing the headword (PHRASES section often
  // lists "no excuse for", "with the excuse that", etc.).
  if (w.includes(' ') && (w.includes(t) || t.includes(' '))) return w;
  // Verb-after patterns.
  if (/(NOUN|N)\s*\+\s*VERB|^VERB$/.test(cat)) return `${t} ${w}`;
  // Verb-before patterns.
  if (/VERB\s*\+\s*NOUN|VERB\s*\+/.test(cat)) return `${w} ${t}`;
  // Adjective patterns.
  if (/^ADJ/.test(cat)) return `${w} ${t}`;
  // Adverb modifying verb / adj.
  if (/^ADV/.test(cat)) return `${w} ${t}`;
  // Preposition patterns.
  if (/^PREP/.test(cat)) return `${t} ${w}`;
  // Quantifier ("a lot of <noun>").
  if (/QUANT/.test(cat)) return `${w} of ${t}`;
  // Default: assume word follows the head.
  return `${t} ${w}`;
}
