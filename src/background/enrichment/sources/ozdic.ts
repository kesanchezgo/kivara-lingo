/**
 * Ozdic — Oxford Collocations Dictionary mirror — VIP source.
 *
 * Ozdic is a Nuxt 3 application that fronts a JSON API. We hit the
 * search endpoint directly — much more reliable than parsing the
 * `__NUXT_DATA__` blob from the page HTML.
 *
 *   GET https://ozdic.com/api/search?q=<word>
 *
 * Verified live 2026-05 returning JSON shape:
 *   {
 *     word: "excuse",
 *     pos: [{ p: "verb", n: 4 }, { p: "noun", n: 3 }],
 *     definitions: [
 *       {
 *         pos: "verb",
 *         senses: [{ gloss: "...", examples: ["..."] }]
 *       }
 *     ],
 *     collocations: [
 *       {
 *         n: 1,
 *         gloss: "(noun.) reason given",
 *         groups: [
 *           {
 *             cat: "ADJ" | "VERB + NOUN" | "PREP" | ...,
 *             clusters: [
 *               { words: ["good", "legitimate"], example: "..." }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * NOTE: previous draft used `/collocation/<word>` (404) and looked for
 * `senses[].collocations[]`. Audit run on 2026-05-22 confirmed the JSON
 * endpoint above is live and that collocations live at the top level.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentSource, SenseRelationGroup, SourcePartial } from '../types';

interface OzdicCluster {
  words?: string[];
  example?: string;
}

interface OzdicGroup {
  cat?: string;
  clusters?: OzdicCluster[];
}

interface OzdicCollocation {
  n?: number;
  gloss?: string;
  groups?: OzdicGroup[];
}

interface OzdicSense {
  gloss?: string;
  examples?: string[];
}

interface OzdicDefinition {
  pos?: string;
  senses?: OzdicSense[];
}

interface OzdicResponse {
  word?: string;
  definitions?: OzdicDefinition[];
  collocations?: OzdicCollocation[];
}

export const ozdicSource: EnrichmentSource = {
  id: 'ozdic',
  label: 'Oxford Coll.',
  async enrich(token, ctx): Promise<SourcePartial> {
    const src = (ctx.sourceLang || 'en').slice(0, 2);
    if (src !== 'en') return {};

    const url = `https://ozdic.com/api/search?q=${encodeURIComponent(token.trim().toLowerCase())}`;
    const data = await fetchJson<OzdicResponse>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!data?.definitions?.length) return {};

    const collocations = new Set<string>();
    const examples: Array<{ text: string }> = [];
    const definitions: string[] = [];
    const headword = (data.word || token).trim().toLowerCase();

    for (const def of data.definitions) {
      for (const sense of def.senses ?? []) {
        if (sense.gloss) {
          const g = sense.gloss.trim();
          if (g && g.length > 6) definitions.push(g);
        }
        for (const ex of sense.examples ?? []) {
          const t = (ex || '').trim();
          if (t.length > 8 && t.length < 220) examples.push({ text: t });
        }
      }
    }

    // Top-level `collocations[].groups[].clusters[].words[]` with `cat`
    // telling us which side of the headword the collocate goes on.
    // The `cat` field includes the actual headword in upper-case
    // (e.g. "VERB + EXCUSE", "EXCUSE + VERB"), so we match against
    // the headword to decide the phrase order.
    //
    // SENSE-AWARE: every collocation block carries a `gloss` naming its
    // sense ("(noun.) of success/failure", "(noun.) on foot"). The block
    // is published as a relationGroup with that gloss as its definition,
    // so the merger's contextual selector picks the collocations of the
    // RIGHT sense instead of dumping every sense's phrases (verified live
    // 2026-08-30: `run` exposes six noun-sense blocks; the old flat dump
    // mixed nautical/cricket/theatre phrases into every lookup).
    const HW = headword.toUpperCase();
    const verbBefore = new RegExp(`VERB\\s*\\+\\s*${HW}`);
    const verbAfter = new RegExp(`${HW}\\s*\\+\\s*VERB`);
    const relationGroups: SenseRelationGroup[] = [];
    for (const block of data.collocations ?? []) {
      const groupCollocations = new Set<string>();
      const groupExample = block.groups?.[0]?.clusters?.[0]?.example?.trim();
      for (const group of block.groups ?? []) {
        const cat = (group.cat || '').toUpperCase();
        for (const cluster of group.clusters ?? []) {
          for (const w of cluster.words ?? []) {
            const raw = (w || '').trim();
            if (!raw) continue;
            // ozdic packs cluster variants in ONE comma-separated string
            // ("long,winning", "go for,have"). Split them so every
            // published collocation is a single clean phrase instead of
            // "long,winning run" (verified live 2026-08-30).
            for (const word of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
              let phrase: string;
              if (/^ADJ/.test(cat)) {
                phrase = `${word} ${headword}`;
              } else if (verbBefore.test(cat) || /^VERB$/.test(cat)) {
                phrase = `${word} ${headword}`;
              } else if (verbAfter.test(cat)) {
                phrase = `${headword} ${word}`;
              } else if (/^PREP/.test(cat)) {
                phrase = `${headword} ${word}`;
              } else if (/^QUANT/.test(cat)) {
                phrase = `${word} of ${headword}`;
              } else if (/^PHR|^PHRASES?$/.test(cat)) {
                phrase = word; // phrases are full chunks already
              } else {
                phrase = `${word} ${headword}`;
              }
              if (phrase && phrase.length < 60) groupCollocations.add(phrase);
              if (groupCollocations.size >= 12) break;
            }
          }
          // Cluster-level example sentence (sometimes the only clean
          // example the entry provides).
          if (cluster.example && cluster.example.length > 8 && cluster.example.length < 220) {
            examples.push({ text: cluster.example.trim() });
          }
        }
      }
      if (groupCollocations.size) {
        relationGroups.push({
          guide: (block.gloss || '').replace(/^\s*\((noun|verb|adj|adv)\.\)\s*/i, '').trim() || undefined,
          ...(groupExample ? { example: groupExample } : {}),
          definition: block.gloss?.trim() || `collocations of ${headword}`,
          collocations: Array.from(groupCollocations).slice(0, 12),
        });
        for (const phrase of groupCollocations) collocations.add(phrase);
        if (collocations.size >= 24) break;
      }
    }

    const partial: SourcePartial = {};
    if (definitions.length) partial.definitions = definitions.slice(0, 4);
    if (examples.length) partial.examples = examples.slice(0, 6);
    if (collocations.size) partial.collocations = Array.from(collocations).slice(0, 20);
    // Sense-bound collocation groups ride the same contextual gate as
    // synonym/antonym groups in the merger.
    if (relationGroups.length) partial.relationGroups = relationGroups;
    return partial;
  },
};
