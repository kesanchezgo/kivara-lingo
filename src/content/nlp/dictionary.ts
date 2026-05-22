import enDict from '../../assets/dictionaries/en.json';
import enMwes from '../../assets/mwes/en.json';
import enPhrasalAcademic from '../../assets/mwes/en-phrasal-academic.json';
import enExtensions from '../../assets/dictionaries/en-extensions.json';
import enCefr from '../../assets/dictionaries/en-cefr.json';
import enCollocations from '../../assets/collocations/academic-collocation-list.json';
import enThesaurus from '../../assets/thesaurus/en-thesaurus.json';
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
const { _meta: _enCefrMeta, ...enCefrEntries } = enCefr as Record<string, unknown>;
void _enCefrMeta;
const { _meta: _enPhrasalMeta, ...enPhrasalAcademicEntries } = enPhrasalAcademic as Record<
  string,
  unknown
>;
void _enPhrasalMeta;
const { _meta: _enThesMeta, ...enThesaurusEntries } = enThesaurus as Record<
  string,
  unknown
>;
void _enThesMeta;

const enMerged: Record<string, DictionaryEntry> = {
  ...(enMwes as Record<string, DictionaryEntry>),
  // Oxford Phrasal Academic Lexicon — academic chunks tokenized as a
  // single MWE. Lower priority than `en.json` proper, so an entry
  // already covered by the curated dict keeps its richer fields.
  ...(enPhrasalAcademicEntries as Record<string, DictionaryEntry>),
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

// Overlay the Oxford 3000/5000 CEFR levels onto every entry the
// bundled dictionary already covers. Words present in CEFR but NOT
// in the bundled dictionary get a stub so the tokenizer headword Set
// recognises them and the popover renders the level badge.
for (const [key, level] of Object.entries(
  enCefrEntries as Record<string, string>,
)) {
  if (!key) continue;
  const k = key.toLowerCase();
  const validLevel = /^(A1|A2|B1|B2|C1|C2)$/.test(level)
    ? (level as DictionaryEntry['level'])
    : undefined;
  if (!validLevel) continue;
  const existing = enMerged[k];
  if (existing) {
    if (!existing.level) existing.level = validLevel;
  } else {
    enMerged[k] = {
      token: k,
      type: 'word',
      translation: '\u2014',
      level: validLevel,
    };
  }
}

// Overlay synonyms and antonyms from the public-domain Fernald thesaurus
// (1896). 610 entries — covers the high-frequency vocabulary the popover
// is most likely to surface. Words also covered by the multi-source
// chain (Datamuse / WordNet / Cambridge Thesaurus) get richer lists at
// runtime; this overlay is the offline-first baseline so the popover
// shows synonyms even with VIP off and zero internet.
for (const [key, value] of Object.entries(
  enThesaurusEntries as Record<string, { syn?: string[]; ant?: string[] }>,
)) {
  if (!value || typeof value !== 'object') continue;
  const syn = Array.isArray(value.syn) ? value.syn : [];
  const ant = Array.isArray(value.ant) ? value.ant : [];
  const existing = enMerged[key];
  if (existing) {
    if (syn.length && !existing.synonyms) existing.synonyms = syn;
    if (ant.length && !existing.antonyms) existing.antonyms = ant;
  } else if (syn.length || ant.length) {
    enMerged[key] = {
      token: key,
      type: 'word',
      translation: '\u2014',
      synonyms: syn.length ? syn : undefined,
      antonyms: ant.length ? ant : undefined,
    };
  }
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
