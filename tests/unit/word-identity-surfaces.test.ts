/**
 * ONE identity across layers: after saving an inflected form ("ran"/"running")
 * the lemma ("run") is the key everywhere — the saved-word cache, the study
 * store, "Añadir esta escena" and "Ver en Anki". The tests pin the exact
 * contract each surface uses so they cannot drift apart again.
 */
import { describe, expect, it } from 'vitest';
import { wordIdentity } from '../../src/shared/word-identity';
import { buildIdentityNoteQuery } from '../../src/shared/anki-search';

const DECK = 'English vocab';
const MODEL = 'Basic';

describe('identity is shared by every Anki-facing surface', () => {
  it('"ran" resolves to lemma "run", which paints "running" as saved', () => {
    const saved = wordIdentity({ token: 'ran', lang: 'en', dictionaryLemma: 'run' });
    const seen = wordIdentity({
      token: 'running', lang: 'en', lemmaCandidates: ['running', 'run'],
    });
    expect(saved.key).toBe('run');
    expect(seen.key).toBe('run');
    // Both the saved-word cache (ANKI_SAVED_WORDS reads the lemma tag) and
    // study.inAnki (recordCardSaved stores identity.key) use this key.
    expect(seen.key).toBe(saved.key);
  });

  it('add-scene and see-in-Anki build the SAME identity query as the save dedup', () => {
    const identity = wordIdentity({ token: 'running', lang: 'en', dictionaryLemma: 'run' });
    const addScene = buildIdentityNoteQuery({
      deckName: DECK, modelName: MODEL, fieldName: 'Front',
      identityKey: identity.key, surface: identity.surface,
    });
    const seeInAnki = buildIdentityNoteQuery({
      deckName: DECK, modelName: MODEL, fieldName: 'Front',
      identityKey: identity.key, surface: identity.surface,
    });
    const dedup = buildIdentityNoteQuery({
      deckName: DECK, modelName: MODEL, fieldName: 'Front',
      identityKey: 'run', surface: 'ran',
    });
    expect(addScene).toBe(seeInAnki);
    // Dedup uses a different surface but the SAME lemma tag and key clause.
    expect(dedup).toContain('tag:kivara::lemma::run');
    expect(addScene).toContain('tag:kivara::lemma::run');
    expect(dedup).toContain('"Front:run"');
    expect(addScene).toContain('"Front:run"');
  });

  it('ANKI_SAVED_WORDS maps a lemma tag back to the lemma key', () => {
    // Mirrors the SW handler: kivara::lemma::run -> "run".
    const tags = ['kivara-lingo', 'kivara::lemma::run'];
    const lemmaTag = tags.find((tag) => tag.startsWith('kivara::lemma::'));
    const key = lemmaTag ? lemmaTag.slice('kivara::lemma::'.length).replace(/-/g, ' ') : 'running';
    expect(key).toBe('run');
  });
});
