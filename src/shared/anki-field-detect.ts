/**
 * Heuristic auto-mapper from an Anki field name to a Kivara `FieldSource`.
 *
 * Used by both the onboarding wizard (first-run setup) and the Cards tab
 * (re-mapping after model changes). Centralised here so a regex tweak is
 * picked up by both call sites — having two slightly different detectors
 * caused real bugs (the previous onboarding hint table missed `Front` /
 * `Back` / `Sentence` patterns the CardsTab matched).
 *
 * Regex order matters: more specific patterns (audio sub-types,
 * "monolingual" inside "definition") come before broader ones to avoid
 * false matches. Patterns are case-insensitive and matched against the
 * lowercased + trimmed field name.
 */
import type { FieldSource } from './types';

export function detectFieldSource(fieldName: string): FieldSource {
  const n = fieldName.toLowerCase().trim();
  // Audio first — most specific.
  if (/audio/.test(n)) {
    if (/word|palabra|term/.test(n)) return 'word-audio';
    return 'sentence-audio'; // default: cue/sentence audio
  }
  if (/picture|frame|screenshot|captura/.test(n)) return 'frame';
  if (/image|imagen|illustration|ilustración|ilustracion/.test(n)) return 'image';
  if (/phon|ipa|pronun/.test(n)) return 'phonetic';

  // AI fields are explicit opt-in rich-card extras. Match them before the
  // generic dictionary buckets below so "AI Definition" does not collapse
  // into the regular `monolingual` field, and "AI Synonyms" does not
  // collapse into the merged multi-source `synonyms` field.
  const aiNamed = /\b(ai|ia|llm|gpt)\b/.test(n);
  if (aiNamed) {
    if (/definition|definic|meaning/.test(n)) return 'ai-definition';
    if (/synonym|sinónimo|sinonimo/.test(n)) return 'ai-synonyms';
    if (/colloc|colocac|combinaciones|combos|chunk/.test(n)) return 'ai-collocations';
    if (/nuance|matiz|nuanced/.test(n)) return 'ai-nuance';
    if (/register|registro|formal|slang/.test(n)) return 'ai-register';
  }

  if (/monoling|definition|definic|meaning|sentido/.test(n)) return 'monolingual';
  if (/biling/.test(n)) return 'bilingual';
  // Multi-source enrichment fields. Match before the generic "example"
  // / "translation" rules so a field literally called "Synonyms" or
  // "Collocations" gets the dedicated source.
  if (/synonym|sinónimo|sinonimo/.test(n)) return 'synonyms';
  if (/antonym|antónimo|antonimo|opposite/.test(n)) return 'antonyms';
  if (/colloc|colocac|combinaciones|combos|chunk/.test(n)) return 'collocations';
  if (/frequency|frecuencia|freq|word rank|rango/.test(n)) return 'frequency';
  if (/etymolog|etimolog|origin/.test(n)) return 'etymology';
  if (/mnemonic|nemot|mnemot|memo/.test(n)) return 'mnemonic';
  if (/youglish|video|youtube/.test(n)) return 'video-link';
  if (/example|ejemplo/.test(n)) return 'examples';
  if (/translation|traducci|native|spanish|español/.test(n)) return 'translation';
  if (/sentence|frase|context|cue|reverso|extra/.test(n)) return 'cue';
  if (/word|palabra|term|anverso|texto|front/.test(n)) return 'selection';
  return 'manual';
}

/**
 * Build a complete `fieldSources` mapping for the given Anki fields by
 * applying `detectFieldSource` to each one, while preserving any explicit
 * user choices that already exist in `existing`.
 *
 * @param fields    AnkiConnect field names (`modelFieldNames` response)
 * @param existing  Current `mapping.fieldSources` to honour as overrides
 * @returns         Fresh mapping ready to assign to `ankiMapping.fieldSources`
 */
export function autoMapFields(
  fields: string[],
  existing: Record<string, FieldSource> = {},
): Record<string, FieldSource> {
  const next: Record<string, FieldSource> = {};
  for (const field of fields) {
    next[field] = existing[field] ?? detectFieldSource(field);
  }
  return next;
}
