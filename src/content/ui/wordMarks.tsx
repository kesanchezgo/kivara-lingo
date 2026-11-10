/**
 * Word marks for the subtitle overlay (ported from the prototype,
 * docs/REDESIGN-V2.md §5.1).
 *
 * The mark is the ONLY visual the overlay adds to a token: the text keeps the
 * colour the user chose in Subtitles and the state is read from the underline
 * (colour AND pattern, per theme.css). Two independent axes:
 *
 *  - type: an expression (MWE) carries a bracket under all of its words;
 *  - status: new / learning / known tints that bracket or draws a dotted line.
 *
 * F3 ships the TYPE axis only. The status axis needs the per-language word
 * state that lands in F5, so `markOf` deliberately returns no status yet: the
 * CSS already understands `data-ws`, and adding it in F5 is a one-line change
 * here, not a view rewrite.
 */
import type { Token } from '../nlp/tokenize';

/** Word state once F5 adds per-language storage. */
export type WordStatus = 'new' | 'learning' | 'known';

/** How a never-seen word is underlined (study.newMarks). */
export type NewMarks = 'dotted' | 'none';

export interface TokenMark {
  status?: WordStatus;
  /** Expression bracket. */
  expr: boolean;
}

/** Type-only mark for a tokenizer token. F5 adds `status`. */
export function markOf(tok: Token): TokenMark {
  return { expr: tok.kind === 'mwe' };
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