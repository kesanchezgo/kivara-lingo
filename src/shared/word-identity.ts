import { htmlToPlain } from './anki-text';

/**
 * Shared word identity — ONE key per lemma+meaning across every layer.
 *
 * The content script owns the actual lemmatization (it already has tok.lemma,
 * lookupDictionary(...).lemmaOf, Yomitan headwords and the MWE index). This
 * module deliberately has NO dependency on content-only modules: it takes the
 * resolved forms as hints and applies a single, deterministic normalization
 * so the background, the study store, the registry and the Anki tags all agree
 * on what "the same word" means.
 *
 * Key rules from product decision:
 *   - key = normalized dictionary form (lowercase, NFC); accents are PRESERVED
 *     (naïve stays naïve — do not copy the accent-insensitive search helpers).
 *   - multi-word expressions reduce to their BASE form ("gave up" -> "give up").
 *   - no lemmatizer for the language -> lowercase surface fallback.
 *   - apostrophes are folded (U+2018/U+2019/U+02BC -> ASCII ') — the same
 *     canonicalization the study store uses for status keys.
 */
export type WordIdentitySource = 'dictionary' | 'lemmatizer' | 'yomitan' | 'mwe' | 'surface';

export interface WordIdentityInput {
  /** Surface form as it appears in the subtitle. */
  token: string;
  /** The cue the token came from (used only to disambiguate MWE candidates). */
  sentence?: string;
  /** BCP-47 language. Lemmatizer hints are only trusted for `en`. */
  lang?: string;
  /** 'expression' means the token is a multi-word expression. */
  kind?: 'word' | 'expression' | 'cloze';
  /** Dictionary lemma (`lookupDictionary(...).lemmaOf`). */
  dictionaryLemma?: string;
  /** True when the resolved entry came from a Yomitan pack. */
  fromYomitan?: boolean;
  /**
   * Ordered lemma candidates from the caller's lemmatizer (`lemmaCandidates`
   * for single words, `mweLemmaCandidates` for expressions). candidate[0] is
   * conventionally the literal surface; it is ignored here.
   */
  lemmaCandidates?: readonly string[];
}

export interface WordIdentity {
  /** Normalized dictionary form — the identity key. */
  key: string;
  /** Normalized surface form (as seen in the subtitle). */
  surface: string;
  /** Where the key came from. */
  source: WordIdentitySource;
}

const APOSTROPHES = /[\u2018\u2019\u02BC]/g;

/**
 * Canonical key normalization. NFC + lowercase + apostrophe fold + trimmed
 * internal whitespace. Unlike the study/frequency `normalize` helpers this
 * PRESERVES diacritics — a dictionary key is not an accent-insensitive search.
 */
export function normalizeIdentityKey(value: string): string {
  return String(value ?? '')
    .replace(APOSTROPHES, "'")
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Anki tag fragment for a lemma key. Anki tags cannot contain spaces, so
 * (word) spaces become '-' (matching the product decision). The fragment is
 * safe to place after `kivara::lemma::` — callers escape the full tag with
 * escapeAnkiSearchTerm when building a query.
 */
export function lemmaTagFragment(key: string): string {
  return normalizeIdentityKey(key).replace(/\s+/g, '-');
}

/** Full lemma tag written on every new note. */
export function lemmaTag(key: string): string {
  return `kivara::lemma::${lemmaTagFragment(key)}`;
}

/**
 * Normalized sense/gloss used for comparison AND as the Anki tag fragment.
 * Glosses that differ only by case/apostrophes/whitespace collapse to one
 * sense; the tag keeps the normalized text with spaces -> '-'.
 */
function normalizeSenseGloss(gloss: string): string {
  // Double quotes (straight or curly) never carry meaning in a gloss.
  return normalizeIdentityKey(String(gloss ?? '').replace(/["“”]/g, ''))
    .replace(/\s+/g, '-');
}

/** Full sense tag: kivara::sense::<normalized gloss>. */
export function senseTag(gloss: string): string {
  return `kivara::sense::${normalizeSenseGloss(gloss)}`;
}

/**
 * Boundary cleaning for a contextual gloss: blank, "-" and the "—" placeholder
 * mean NO gloss — never a sense tag shaped `kivara::sense::-`.
 */
export function normalizeContextGloss(value: string | undefined | null): string | undefined {
  const t = String(value ?? '').trim();
  return t && t !== '—' && t !== '-' ? t : undefined;
}

/** Decode the lemma key carried by a note's kivara::lemma:: tag (spaced). */
export function lemmaFromTags(tags: readonly string[] | undefined | null): string | null {
  const tag = (tags ?? []).find((t) => t.startsWith('kivara::lemma::'));
  return tag ? tag.slice('kivara::lemma::'.length).replace(/-/g, ' ') : null;
}

/** BOTH forms of a lemma key: spaced AND hyphenated (tags cannot hold spaces). */
export function lemmaTagVariants(key: string): string[] {
  const k = normalizeIdentityKey(key);
  if (!k) return [];
  return [...new Set([k, k.replace(/\s+/g, '-'), k.replace(/-/g, ' ')])];
}

/** The save path a card came from — it decides phrase-level treatment. */
export type PhraseSavePath = 'word' | 'selection' | 'line';

/**
 * A PHRASE-LEVEL save is decided by the PATH, not by text equality: the
 * whole-line shortcut save is always one; a selection of 2+ words covering
 * the line (or anything >4 words) is one; every WORD path (hover, popover,
 * single new word, detected expression) is one only above four words — a
 * one-word line ("Running") or a two-word expression on its own line
 * ("Thank you") is vocabulary and keeps its lemma/sense identity.
 */
export function isPhraseLevelSave(
  text: string,
  sentence?: string,
  path: PhraseSavePath = 'word',
): boolean {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (path === 'line') return true;
  if (words.length > 4) return true;
  if (path === 'selection' && words.length >= 2) {
    const saved = normalizeIdentityKey(text);
    const line = normalizeIdentityKey(sentence ?? '');
    return saved !== '' && saved === line;
  }
  return false;
}

/**
 * Sense classification from two glosses (already normalized for comparison).
 * Two senses are the SAME when they share at least one normalized gloss;
 * DIFFERENT when both are known and disjoint; UNKNOWN when either is missing.
 */
/** Strip HTML/entities via the SHARED normalizer, then grammatical "(v.)" parentheses. */
function cleanGloss(value: string): string {
  return htmlToPlain(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function classifySense(
  contextGloss: string | undefined,
  storedGloss: string | undefined,
): 'new-sense' | 'same-sense' | 'unknown' {
  const ctx = cleanGloss(contextGloss ?? '');
  const stored = cleanGloss(storedGloss ?? '');
  if (!ctx || !stored) return 'unknown';
  if (ctx === stored) return 'same-sense';
  // A gloss can list several meanings separated by ';', '/', '&' or ',' —
  // any shared meaning makes them the same sense.
  const parts = (s: string) => s.split(/[;,/&]/).map((x) => x.trim()).filter(Boolean);
  const ctxParts = parts(ctx);
  const storedParts = parts(stored);
  return ctxParts.some((p) => storedParts.includes(p)) ? 'same-sense' : 'new-sense';
}

/**
 * Derive the identity. Priority:
 *   1. explicit dictionary lemma (authoritative citation form)
 *   2. Yomitan-flagged candidate (pack headword)
 *   3. MWE base candidate (when kind==='expression' or token has a space)
 *   4. lemmatizer candidate
 *   5. normalized surface
 */
export function wordIdentity(input: WordIdentityInput): WordIdentity {
  const surface = normalizeIdentityKey(input.token);
  const candidates = (input.lemmaCandidates ?? [])
    .map(normalizeIdentityKey)
    .filter((c) => c && c !== surface);
  const isMwe = input.kind === 'expression' || surface.includes(' ');

  const dictionaryLemma = normalizeIdentityKey(input.dictionaryLemma ?? '');
  if (dictionaryLemma && dictionaryLemma !== surface) {
    return { key: dictionaryLemma, surface, source: 'dictionary' };
  }
  if (input.fromYomitan && candidates.length) {
    return { key: candidates[0], surface, source: 'yomitan' };
  }
  if (isMwe && candidates.length) {
    return { key: candidates[0], surface, source: 'mwe' };
  }
  if (candidates.length) {
    return { key: candidates[0], surface, source: 'lemmatizer' };
  }
  return { key: surface, surface, source: 'surface' };
}
