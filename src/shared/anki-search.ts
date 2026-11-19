/**
 * Shared Anki search-query helpers.
 *
 * One implementation for BOTH call sites (service-worker ANKI_SAVED_WORDS
 * and capture-orchestrator retry idempotency) — the previous local `esc`
 * inline in the orchestrator escaped only `\` and `"` while the SW escaped
 * `*` and `_` too, so the two queries disagreed on the same deck name.
 *
 * Anki search syntax: `\` escapes the next character; `*`, `_`, `"`, `\`
 * are the metacharacters that break a literal phrase match. Field values
 * are quoted as a whole (`"field:value"`) so a value containing `:` or
 * spaces still matches exactly. `note:"<model>"` pins the note type so
 * the same token in a different model doesn't count as the same card.
 */
import { lemmaTag } from './word-identity';

/** Escape a single Anki search term (deck name, field value, …). */
export function escapeAnkiSearchTerm(term: string): string {
  let e = String(term ?? '');
  e = e.split('\\').join('\\\\');
  e = e.split('"').join('\\"');
  e = e.split('*').join('\\*');
  e = e.split('_').join('\\_');
  return e;
}

/**
 * Build a query that matches ONE exact card:
 * `deck:"<escaped deck>" note:"<model>" "<field>:<escaped value>"`
 *
 * Returns null when the required parts are missing so callers can skip
 * the check instead of firing an over-broad query.
 */
export function buildExactNoteQuery(opts: {
  deckName?: string;
  modelName?: string;
  fieldName?: string;
  value?: string;
}): string | null {
  const deck = (opts.deckName ?? '').trim();
  const field = (opts.fieldName ?? '').trim() || 'Front';
  const value = (opts.value ?? '').trim();
  if (!deck || !value) return null;
  const model = (opts.modelName ?? '').trim();
  const deckClause = `deck:"${escapeAnkiSearchTerm(deck)}"`;
  const noteClause = model ? ` note:"${escapeAnkiSearchTerm(model)}"` : '';
  return `${deckClause}${noteClause} "${escapeAnkiSearchTerm(field)}:${escapeAnkiSearchTerm(value)}"`;
}

/**
 * Build the UNIFIED identity query: deck + model + (lemma tag OR surface OR
 * key). Every clause uses escapeAnkiSearchTerm — the lemma tag carries the
 * normalized key, which may contain apostrophes, `_`, `*` or non-Latin
 * scripts. The two field clauses catch pre-tag notes (the old kivara-only
 * notes written before this identity scheme).
 *
 * Returns null when deck or the identity key is missing so callers never fire
 * an over-broad deck-only query by accident.
 */
export function buildIdentityNoteQuery(opts: {
  deckName?: string;
  modelName?: string;
  fieldName?: string;
  /** Normalized lemma key (already NFC/lowercase from word-identity.ts). */
  identityKey?: string;
  /** Normalized surface form; defaults to the key when absent. */
  surface?: string;
}): string | null {
  const deck = (opts.deckName ?? '').trim();
  const key = (opts.identityKey ?? '').trim();
  if (!deck || !key) return null;
  const field = (opts.fieldName ?? '').trim() || 'Front';
  const model = (opts.modelName ?? '').trim();
  const surface = (opts.surface ?? '').trim() || key;
  const tag = lemmaTag(key);
  const clauses = [
    `tag:${escapeAnkiSearchTerm(tag)}`,
    `"${escapeAnkiSearchTerm(field)}:${escapeAnkiSearchTerm(surface)}"`,
  ];
  if (surface !== key) {
    clauses.push(`"${escapeAnkiSearchTerm(field)}:${escapeAnkiSearchTerm(key)}"`);
  }
  const deckClause = `deck:"${escapeAnkiSearchTerm(deck)}"`;
  const noteClause = model ? ` note:"${escapeAnkiSearchTerm(model)}"` : '';
  return `${deckClause}${noteClause} (${clauses.join(' OR ')})`;
}
