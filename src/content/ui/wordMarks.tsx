/**
 * Word marks for the subtitle overlay (ported from the prototype,
 * docs/REDESIGN-V2.md §5.1, §7 F5).
 *
 * The mark is the ONLY visual the overlay adds to a token: the text keeps the
 * colour the user chose in Subtitles and the state is read from the underline
 * (colour AND pattern, per theme.css). Two independent axes:
 *
 *  - type: an expression (MWE) carries a bracket under all of its words;
 *  - status: new / learning / known tints that bracket or draws a dotted line
 *    (known draws nothing).
 *
 * The status comes from the per-language profile (mark > Anki > estimate). It
 * is passed as a resolver instead of read here, so this module stays free of
 * storage and React.
 *
 * Reconciliation with the tokenizer taxonomy: the tokenizer also has a
 * `mastered` kind (an explicit «already learned» set). In v2 «mastered» IS the
 * «known» status — `markOf` maps it to `known` whether or not a resolver is
 * present, so the two taxonomies cannot drift apart again.
 */
import type { Token } from '../nlp/tokenize';

/** Word state (same union as the study layer). */
export type WordStatus = 'new' | 'learning' | 'known';

/** How a never-seen word is underlined (study.newMarks). */
export type NewMarks = 'dotted' | 'none';

export interface TokenMark {
  status?: WordStatus;
  /** Expression bracket. */
  expr: boolean;
}

/** Kinds that carry a word status: vocabulary the learner can mark. */
const MARKABLE = new Set<Token['kind']>(['mwe', 'known', 'unknown', 'mastered']);

/**
 * Mark of a tokenizer token. `statusOf` resolves the profile's status by
 * lemma; without it only the type axis is drawn (F3 behaviour).
 */
export function markOf(tok: Token, statusOf?: (tokenKey: string) => WordStatus): TokenMark {
  const expr = tok.kind === 'mwe';
  // «mastered» is the tokenizer's explicit learned set: it IS «known», with or
  // without a profile resolver.
  if (tok.kind === 'mastered') return { status: 'known', expr };
  if (!statusOf || !MARKABLE.has(tok.kind)) return { expr };
  // The tokenizer already resolved the lemma; its key is the citation form.
  return { status: statusOf(tok.lemma ?? tok.key), expr };
}

export function markAttrs(mark: TokenMark): Record<string, string | undefined> {
  return { 'data-ws': mark.status, 'data-expr': mark.expr ? '' : undefined };
}

/** Attribute of the container that applies the new-word mark preference. */
export function markContainerAttrs(newMarks: NewMarks): Record<string, string> {
  return { 'data-new-marks': newMarks };
}

/**
 * Ink for marks on panel and card surfaces: same hue as the video mark, one
 * step darker on white to keep the contrast (>= 3:1). Without this class the
 * overlay ink is used.
 */
export const MARK_INK =
  '[--kvl-ink-new:#0284c7] [--kvl-ink-learning:#ea580c] [--kvl-ink-neutral:rgb(24_24_27/0.5)] ' +
  'dark:[--kvl-ink-new:#38bdf8] dark:[--kvl-ink-learning:#fb923c] dark:[--kvl-ink-neutral:rgb(255_255_255/0.5)]';

/**
 * Miniature mark (card status selector, Subtitles legend, episode word list).
 * `expr` draws the expression bracket, neutral by default; `tint` colours it
 * with the state, as the video does.
 */
export function StatusGlyph({ status, expr, tint }: { status: WordStatus; expr?: boolean; tint?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`${MARK_INK} kvl-glyph`}
      data-ws={status}
      data-expr={expr ? '' : undefined}
      data-tint={expr && tint ? '' : undefined}
    />
  );
}