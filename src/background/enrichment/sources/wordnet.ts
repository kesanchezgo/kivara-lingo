/**
 * Open English WordNet source — Standard tier.
 *
 * A locally bundled, sense-bound lexical dataset derived from the official
 * Open English WordNet 2025 JSON release. It powers the fields that open
 * providers are structurally bad at on their own:
 *
 *   1. `relationGroups` — every synset becomes a sense group carrying its
 *      own synonyms AND direct antonyms. The merger's contextual selector
 *      (`pickSenseRelationGroups`) then picks the group matching the
 *      sentence, so "run" in "She runs the company" publishes manage/
 *      operate instead of sprint/jog.
 *   2. `definitions` — sense-order definitions (most frequent sense
 *      first) so the contextual definition ranking gets real candidates
 *      even when the dictionary layer is silent.
 *   3. `examples` — WordNet usage examples, sense-scoped so they cannot
 *      contaminate a different sense.
 *
 * Design notes:
 *   - NO network. Data lives in `src/assets/wordnet/<letter>.json`,
 *     loaded via dynamic `import()` so only the one shard a word needs is
 *     ever read (0.1–3.3 MB instead of the 27 MB whole dataset).
 *   - English only; other source languages return `{}` immediately.
 *   - The flat `synonyms`/`antonyms` fields are intentionally NOT filled:
 *     publishing them would bypass the per-sense selection the merger
 *     already does for `relationGroups` and reintroduce lemma-level noise
 *     for polysemous words.
 *
 * License: Open English WordNet 2025, © 2019–present The Open English
 * WordNet Team, derived from Princeton WordNet 3.1, © 2011 Princeton
 * University — CC BY 4.0 + WordNet License. See ATTRIBUTIONS.md and the
 * license texts under src/assets/wordnet/.
 */

import { lemmaCandidates } from '../../../content/nlp/lemma';
import { mweLemmaCandidates } from '../../../content/nlp/mwe-lemma';
import type { EnrichmentSource, SourcePartial } from '../types';

interface CompactSense {
  /** WordNet synset id, e.g. "01930264-v". */
  i: string;
  /** Part of speech: n | v | a | r | s. */
  p: string;
  /** Synset gloss (definition). */
  d: string;
  /** Usage examples for this synset. */
  e?: string[];
  /** Synset members other than the headword. */
  s?: string[];
  /** Direct lexical antonyms recorded on the sense. */
  a?: string[];
}

type CompactShard = Record<string, CompactSense[]>;

const shardCache = new Map<string, CompactShard>();

/** Resolved absolute URL of a shard. `eager: true` + `import: 'default'`
 * turns each `?url` import into a plain string constant at build time —
 * no `__vitePreload`, no dynamic import, no `document`/`window` access,
 * so the URLs are usable from the MV3 module service worker. */
const SHARD_URLS = import.meta.glob('../../../assets/wordnet/*.json', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const MAX_SENSE_GROUPS = 20;
const MAX_DEFINITIONS = 20;
const MAX_EXAMPLES = 4;
const MAX_RELATIONS_PER_GROUP = 12;

function shardFor(lemma: string): string {
  const first = lemma.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')?.[0]?.toLowerCase();
  return first && /[a-z]/.test(first) ? first : 'other';
}

/**
 * Fetch a shard as JSON via its resolved asset URL. In the MV3 service
 * worker the URLs are extension-absolute (`/assets/x-hash.json`) and
 * `fetch` works because the SW is served from the extension root.
 * `fetch` — not dynamic `import()` — is the only SW-safe mechanism here:
 * Vite's `__vitePreload` helper (used for every dynamic import) touches
 * `window`/`document`, neither of which exists in the MV3 module SW
 * (verified live 2026-08-30: `window is not defined`). Tests install a
 * fetch stub that serves the shard files from disk.
 */
async function loadShard(shard: string): Promise<CompactShard> {
  const cached = shardCache.get(shard);
  if (cached) return cached;
  const url = SHARD_URLS[`../../../assets/wordnet/${shard}.json`];
  if (!url) return {};
  try {
    const response = await fetch(url);
    if (!response.ok) return {};
    const loaded = (await response.json()) as CompactShard;
    shardCache.set(shard, loaded);
    return loaded;
  } catch {
    return {};
  }
}

/** Candidate dictionary keys for a token: literal first, then lemmas. */
function lemmaKeys(token: string): string[] {
  if (token.includes(' ')) return mweLemmaCandidates(token);
  return lemmaCandidates(token);
}

function relationGroupLimit(count: number): number {
  return Math.min(count, MAX_RELATIONS_PER_GROUP);
}

export const wordnetSource: EnrichmentSource = {
  id: 'wordnet',
  label: 'WordNet',
  async enrich(token, ctx): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2) !== 'en') return {};

    const partial: SourcePartial = {};

    // An inflected hover ("running", "lit") can hit OEWN both as its own
    // lemma (adjective "running") AND through the base form ("run"). Both
    // are real WordNet inventories, so we merge them instead of letting the
    // first hit mask the other. The base (citation) form goes FIRST because
    // that is the entry a learner is really looking up; the literal entry
    // follows. Synsets are deduplicated by id across the merged list.
    const merged: CompactSense[] = [];
    const seenSynsets = new Set<string>();
    const pushEntry = (senses: CompactSense[]) => {
      for (const sense of senses) {
        if (seenSynsets.has(sense.i)) continue;
        seenSynsets.add(sense.i);
        merged.push(sense);
      }
    };
    const keys = lemmaKeys(token);
    let literalEntry: CompactSense[] | undefined;
    for (let i = 0; i < keys.length; i += 1) {
      const shard = await loadShard(shardFor(keys[i]));
      const entry = shard[keys[i].trim().toLowerCase()];
      if (!entry?.length) continue;
      if (i === 0) {
        literalEntry = entry;
      } else {
        pushEntry(entry);
      }
    }
    // Citation-form senses first, then the literal (possibly derived)
    // entry's own senses.
    if (keys.length > 1 && literalEntry) pushEntry(literalEntry);
    else if (keys.length === 1 && literalEntry) pushEntry(literalEntry);
    if (!merged.length) return {};
    const entry = merged;

    // Sense groups keep WordNet's sense order (most frequent sense first
    // for the headword), which is exactly the signal the merger's
    // contextual selector needs. Only the groups that actually carry
    // relations are published; gloss-only synsets contribute nothing here.
    const relationGroups = entry
      .filter((sense) => (sense.s?.length ?? 0) + (sense.a?.length ?? 0) > 0)
      .slice(0, MAX_SENSE_GROUPS)
      .map((sense) => ({
        definition: sense.d,
        ...(sense.e?.length ? { example: sense.e[0] } : {}),
        ...(sense.s?.length ? { synonyms: sense.s.slice(0, relationGroupLimit(sense.s.length)) } : {}),
        ...(sense.a?.length ? { antonyms: sense.a.slice(0, relationGroupLimit(sense.a.length)) } : {}),
      }));

    const definitions = entry
      .map((sense) => sense.d)
      .filter((definition) => definition.trim().length > 2)
      .slice(0, MAX_DEFINITIONS);

    const examples: Array<{ text: string }> = [];
    for (const sense of entry) {
      for (const example of sense.e ?? []) {
        const text = example.trim();
        if (!text || examples.some((existing) => existing.text === text)) continue;
        examples.push({ text });
        if (examples.length >= MAX_EXAMPLES) break;
      }
      if (examples.length >= MAX_EXAMPLES) break;
    }

    if (relationGroups.length) partial.relationGroups = relationGroups;
    if (definitions.length) partial.definitions = definitions;
    if (examples.length) partial.examples = examples;
    return partial;
  },
};
