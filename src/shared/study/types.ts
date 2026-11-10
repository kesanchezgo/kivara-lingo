/** Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged. */

/** CEFR level of a segment or of a study profile. */
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** Kind of card the user can save. `cloze` is the F4 card flavour. */
export type CardKind = 'word' | 'expression' | 'sentence' | 'selection' | 'cloze';

/** Anki mapping settings read by the deck helpers (subset of the full settings type). */
export interface AnkiMapping {
  ankiUrl: string;
  /** Legacy single deck name; only read while `decks` is absent. */
  deckName: string;
  /** Target deck per language being learned. */
  decks?: Record<string, string>;
  modelName?: string;
  fieldSources?: Record<string, unknown>;
}
