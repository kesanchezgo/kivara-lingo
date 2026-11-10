import { describe, expect, it } from 'vitest';
import { deckFor, defaultDeckName, migrateDecks, pinDeck, withDeck } from '../../src/shared/study/decks';
import { t } from '../../src/shared/i18n/core';
import type { AnkiMapping } from '../../src/shared/study/types';

/** The factory name is localized, so the fixture builds it through `t()`
 * instead of hardcoding one locale's wording. */
const FACTORY_DECK = t('cards.deckDefault', { lang: t('lang.en') });

const mapping = (over: Partial<AnkiMapping> = {}): AnkiMapping => ({
  ankiUrl: 'http://127.0.0.1:8765',
  deckName: FACTORY_DECK,
  ...over,
});

describe('decks · defaultDeckName', () => {
  it('builds the per-language default name through the dictionary', () => {
    expect(defaultDeckName('en')).toBe(t('cards.deckDefault', { lang: t('lang.en') }));
    expect(defaultDeckName('fr')).toBe(t('cards.deckDefault', { lang: t('lang.fr') }));
  });

  it('falls back to the raw message key for an unknown language', () => {
    expect(defaultDeckName('xx')).toBe(t('cards.deckDefault', { lang: 'lang.xx' }));
  });
});

describe('decks · migrateDecks', () => {
  it('gives no per-language deck when the factory name was never changed', () => {
    expect(migrateDecks(mapping(), 'en').decks).toEqual({});
  });

  it('moves a user-chosen deck to the active language', () => {
    expect(migrateDecks(mapping({ deckName: 'My Deck' }), 'fr').decks).toEqual({ fr: 'My Deck' });
  });

  it('leaves an already-migrated mapping untouched (same object)', () => {
    const m = mapping({ decks: { en: 'X' } });
    expect(migrateDecks(m, 'en')).toBe(m);
  });
});

describe('decks · deckFor', () => {
  it('reads the per-language deck', () => {
    expect(deckFor(mapping({ decks: { en: 'Mine' } }), 'en')).toBe('Mine');
  });

  it('falls back to the default name', () => {
    expect(deckFor(mapping(), 'en')).toBe(defaultDeckName('en'));
  });
});

describe('decks · withDeck', () => {
  it('sets the deck for a language and keeps the others', () => {
    const next = withDeck(mapping({ decks: { es: 'Otro' } }), 'en', 'Mine');
    expect(next.decks).toEqual({ es: 'Otro', en: 'Mine' });
  });
});

describe('decks · pinDeck', () => {
  it('pins the default name when the language has no deck', () => {
    expect(pinDeck(mapping(), 'en').decks).toEqual({ en: defaultDeckName('en') });
  });

  it('returns the same object when the deck is already pinned', () => {
    const m = mapping({ decks: { en: 'Mine' } });
    expect(pinDeck(m, 'en')).toBe(m);
  });
});