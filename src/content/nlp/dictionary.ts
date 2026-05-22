import enDict from '../../assets/dictionaries/en.json';
import enMwes from '../../assets/mwes/en.json';
import enExtensions from '../../assets/dictionaries/en-extensions.json';
import enCollocations from '../../assets/collocations/academic-collocation-list.json';
import type { DictionaryEntry } from '../../shared/types';
import { lemmaCandidates } from './lemma';

// Strip the `_meta` informational block before treating the file as a
// dictionary so it doesn't pollute lookups.
const { _meta: _enExtMeta, ...enExtensionEntries } = enExtensions as Record<
  string,
  unknown
>;
void _enExtMeta;
const { _meta: _enCollMeta, ...enCollocationEntries } = enCollocations as Record<
  string,
  unknown
>;
void _enCollMeta;

const enMerged: Record<string, DictionaryEntry> = {
  ...(enMwes as Record<string, DictionaryEntry>),
  ...(enDict as Record<string, DictionaryEntry>),
};

for (const [key, value] of Object.entries(
  enExtensionEntries as Record<string, DictionaryEntry>,
)) {
  enMerged[key] = {
    ...(enMerged[key] ?? {}),
    ...value,
  };
}

// Overlay the Academic Collocation List (Ackermann & Chen 2013) so every
// entry the bundled dictionary already covers also gets up to ~12
// curated academic collocations. The popover renders these under
// "Combinaciones" without any network call.
for (const [key, value] of Object.entries(
  enCollocationEntries as Record<string, string[]>,
)) {
  if (!Array.isArray(value)) continue;
  const existing = enMerged[key];
  if (existing) {
    enMerged[key] = {
      ...existing,
      collocations: [
        ...(existing.collocations ?? []),
        ...value.filter((v) => !existing.collocations?.includes(v)),
      ].slice(0, 12),
    };
  } else {
    // Words present only in the collocation list (no full bundled entry)
    // get a stub so the popover can still surface the chunks. The
    // tokenizer's headword-set check picks them up too.
    enMerged[key] = {
      token: key,
      type: 'word',
      translation: '\u2014',
      collocations: value.slice(0, 12),
    };
  }
}

const DICTIONARIES: Record<string, Record<string, DictionaryEntry>> = {
  en: enMerged,
};

/**
 * Returns the entry for a token in a given language, or undefined.
 *
 * Lookup order:
 *   1. Literal lowercased token.
 *   2. Lemma candidates (only for EN — `lemmaCandidates()` returns just the
 *      literal for other languages so this is a no-op there).
 *
 * When the hit comes from a lemma we return a *shallow copy* with the
 * original surface form on `token` so the popover header reads naturally and
 * the resolved lemma is exposed on the optional `lemmaOf` field.
 */
export function lookupDictionary(token: string, lang = 'en'): DictionaryEntry | undefined {
  const dict = DICTIONARIES[lang];
  if (!dict) return undefined;
  const key = token.trim().toLowerCase();
  const direct = dict[key];
  if (direct) return direct;

  // Lemma fallback (EN only — see lemma.ts).
  if (lang !== 'en') return undefined;
  const candidates = lemmaCandidates(token);
  for (let i = 1; i < candidates.length; i++) {
    const hit = dict[candidates[i]];
    if (hit) return { ...hit, token, lemmaOf: candidates[i] };
  }
  return undefined;
}

export function getDictionary(lang = 'en'): Record<string, DictionaryEntry> {
  return DICTIONARIES[lang] ?? {};
}
