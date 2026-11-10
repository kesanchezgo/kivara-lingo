/** Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged. */

import type { AnkiMapping } from './types';
import { t } from '../i18n/core';

/**
 * One target deck per language (`mapping.decks[<language>]`).
 *
 * The deck is where NEW cards are stored, not your vocabulary nor your
 * profile: marks, self-assessment, the test and the level belong to the
 * language (`langProfile`), so changing, moving or renaming the deck does not
 * erase them. Nor is it assumed that the deck holds everything you know: it
 * holds what you have studied with Kivara; the rest is estimated by the model.
 *
 * Default name: «Vocabulario <language>» in the interface language. It is
 * PINNED in `decks` the first time it is used (when saving the first card of
 * that language, `pinDeck`): otherwise changing the interface language would
 * silently change the target deck («Vocabulario Francés» → «French vocabulary»).
 *
 * Compatibility: the previous format had a single global `deckName`.
 *  · If it is the factory one (nobody chose it), each language gets its own:
 *    before, with French active, French and English ended up sharing
 *    «Vocabulario Inglés».
 *  · If the user chose it, it becomes the active language's deck and the other
 *    languages get one of their own.
 */

/** Factory deck name (the English `cards.deckDefault`). Computed through
 * `t()` so the migration compares like with like in every locale. */
const DEFAULT_DECK_NAME = t('cards.deckDefault', { lang: t('lang.en') });

export function defaultDeckName(lang: string): string {
  return t('cards.deckDefault', { lang: t(`lang.${lang}`) });
}

/**
 * Generic over the caller's mapping shape: the settings type and the ported
 * study subset are structurally compatible, and returning the caller's own
 * type keeps `setAnkiMapping` (which requires every settings field) typed
 * without a cast at the call site.
 */
export function migrateDecks<T extends AnkiMapping>(m: T, lang: string): T {
  if (m.decks) return m;
  const chosen = !!m.deckName && m.deckName !== DEFAULT_DECK_NAME;
  return { ...m, decks: chosen ? { [lang]: m.deckName } : {} };
}

/** Deck of a language. If not migrated yet, it is read as if it were (same result before and after). */
export function deckFor(m: AnkiMapping, lang: string): string {
  return migrateDecks(m, lang).decks?.[lang] ?? defaultDeckName(lang);
}

export function withDeck<T extends AnkiMapping>(m: T, lang: string, deck: string): T {
  const base = migrateDecks(m, lang);
  return { ...base, decks: { ...base.decks, [lang]: deck } };
}

/** Pins a language's default name (if it has no saved deck yet). Returns the same object when nothing changes. */
export function pinDeck<T extends AnkiMapping>(m: T, lang: string): T {
  return m.decks?.[lang] ? m : withDeck(m, lang, deckFor(m, lang));
}