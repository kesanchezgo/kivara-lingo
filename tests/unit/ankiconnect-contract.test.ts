/**
 * AnkiConnect client <-> add-on contract.
 *
 * The fixture is generated from the real add-on by
 * `scripts/build-ankiconnect-signatures.mjs`; regenerating it after an
 * AnkiConnect release is what keeps this file honest. These tests fail when a
 * client call names an action the add-on does not expose, when a request
 * carries a parameter the action does not declare, or when `tags` stops being
 * the single space-separated string AnkiConnect requires.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ankiConnect } from '../../src/background/anki-connect';
import { ANKICONNECT_SIGNATURES, createAnkiFake } from '../helpers/ankiconnect';

const CLIENT_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'background', 'anki-connect.ts'),
  'utf8',
);

/** Every `invoke('action', ...)` literal in the client, deduplicated. */
function wrappedActions(): string[] {
  const matches = CLIENT_SOURCE.matchAll(/invoke(?:<[^>]*>)?\(\s*'([A-Za-z0-9_]+)'/g);
  return [...new Set([...matches].map((match) => match[1]))];
}

/** How to exercise each wrapped action through the real client. */
const drivers: Record<string, () => Promise<unknown>> = {
  version: () => ankiConnect.ping('http://127.0.0.1:8765'),
  deckNames: () => ankiConnect.deckNames(),
  modelNames: () => ankiConnect.modelNames(),
  modelFieldNames: () => ankiConnect.modelFieldNames('Basic'),
  addNote: () => ankiConnect.addNote({
    deckName: 'Default',
    modelName: 'Basic',
    fields: { Front: 'sane', Back: 'cuerdo' },
  }),
  updateNoteFields: () => ankiConnect.updateNoteFields(1, { Front: 'sane' }),
  storeMediaFile: () => ankiConnect.storeMediaFile('kivara-test.mp3', 'AAAA'),
  createDeck: () => ankiConnect.createDeck('Kivara'),
  findNotes: () => ankiConnect.findNotes('deck:Default'),
  notesInfo: () => ankiConnect.notesInfo([1]),
  deleteNotes: () => ankiConnect.deleteNotes([1]),
  addTags: () => ankiConnect.addTags(['kivara::word'], [1]),
  guiBrowse: () => ankiConnect.guiBrowse('deck:Default'),
  findCards: () => ankiConnect.findCards('nid:1'),
  cardsInfo: () => ankiConnect.cardsInfo([1]),
};

/** Plausible per-action answers; writes resolve from this map, not from Anki. */
const resolveMap: Record<string, unknown> = {
  version: 6,
  deckNames: ['Default'],
  modelNames: ['Basic'],
  modelFieldNames: ['Front', 'Back'],
  addNote: 123,
  updateNoteFields: null,
  storeMediaFile: 'kivara-test.mp3',
  createDeck: 1,
  findNotes: [1],
  notesInfo: [{ noteId: 1, fields: { Front: { value: 'sane' } }, cards: [1] }],
  deleteNotes: null,
  addTags: null,
  guiBrowse: [1],
  findCards: [1],
  cardsInfo: [{
    cardId: 1,
    noteId: 1,
    deckName: 'Default',
    modelName: 'Basic',
    fields: {},
    interval: 1,
    factor: 2500,
    reps: 1,
    lapses: 0,
    queue: 2,
    due: 1,
  }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnkiConnect client contract', () => {
  it('every action the client wraps exists in the fixture', () => {
    const actions = wrappedActions();
    expect(actions.length).toBeGreaterThan(0);
    const missing = actions.filter((action) => !(action in ANKICONNECT_SIGNATURES.actions));
    expect(missing, `client calls actions missing from the add-on fixture: ${missing.join(', ')}`).toEqual([]);
  });

  it('drives every wrapped action through the client with no rejections', async () => {
    for (const action of wrappedActions()) {
      const driver = drivers[action];
      expect(driver, `no driver for wrapped action '${action}'; add one to this map`).toBeTypeOf('function');

      const fake = createAnkiFake({ resolve: resolveMap });
      try {
        await driver();
        expect(fake.rejections, `${action} must pass fixture validation`).toEqual([]);
        expect(fake.calls.map((call) => call.action)).toContain(action);
      } finally {
        fake.restore();
      }
    }
  });

  it('answers an unsupported action with an AnkiConnect error and records it', async () => {
    const fake = createAnkiFake();
    try {
      const response = await fetch('http://127.0.0.1:8765', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notAnAnkiAction', version: 6, params: {} }),
      });
      const envelope = await response.json() as { result: unknown; error: string | null };
      expect(envelope).toEqual({ result: null, error: 'unsupported action: notAnAnkiAction' });
      expect(fake.rejections).toEqual([
        { action: 'notAnAnkiAction', params: {}, message: 'unsupported action: notAnAnkiAction' },
      ]);
    } finally {
      fake.restore();
    }
  });

  it('rejects a param the action does not declare', async () => {
    const fake = createAnkiFake();
    try {
      const response = await fetch('http://127.0.0.1:8765', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deckNames', version: 6, params: { bogus: 1 } }),
      });
      const envelope = await response.json() as { result: unknown; error: string | null };
      expect(envelope).toEqual({ result: null, error: "unexpected param 'bogus' for deckNames" });
      expect(fake.rejections).toEqual([
        { action: 'deckNames', params: { bogus: 1 }, message: "unexpected param 'bogus' for deckNames" },
      ]);
    } finally {
      fake.restore();
    }
  });

  it('surfaces an AnkiConnect error coming from the fake through the client', async () => {
    // The real client cannot produce a malformed request against a live
    // add-on, so this proves the error path directly: an AnkiConnect-style
    // envelope is turned into an AnkiConnectError by the client.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({ result: null, error: "unexpected param 'bogus' for deckNames" }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )),
    );
    await expect(ankiConnect.deckNames()).rejects.toThrow("unexpected param 'bogus' for deckNames");
  });

  it('rejects tags sent as an array and accepts the client string form', async () => {
    const fake = createAnkiFake({ resolve: { addTags: null } });
    try {
      const response = await fetch('http://127.0.0.1:8765', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addTags', version: 6, params: { tags: ['kivara::word'], notes: [1] } }),
      });
      const envelope = await response.json() as { result: unknown; error: string | null };
      expect(envelope.error).toBe('tags must be a string');
      expect(fake.rejections[0].message).toBe('tags must be a string');

      await ankiConnect.addTags(['kivara::word', 'kivara::lang::en'], [1]);
      expect(fake.rejections).toHaveLength(1);
      expect(fake.calls[1].params.tags).toBe('kivara::word kivara::lang::en');
    } finally {
      fake.restore();
    }
  });

  it('fixture metadata points at the official add-on and is not a stub', () => {
    expect(ANKICONNECT_SIGNATURES._meta.source).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/ankicommunity\/anki-connect\/.+__init__\.py$/,
    );
    expect(ANKICONNECT_SIGNATURES._meta.sha256).toMatch(/^[0-9a-f]{64}$/);

    const entries = Object.entries(ANKICONNECT_SIGNATURES.actions);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, signature] of entries) {
      expect(Array.isArray(signature.params), `${name}.params must be an array`).toBe(true);
      for (const param of signature.params) expect(typeof param).toBe('string');
      for (const param of signature.optional ?? []) expect(signature.params).toContain(param);
    }
  });
});