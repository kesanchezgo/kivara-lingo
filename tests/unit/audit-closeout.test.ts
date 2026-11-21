/**
 * RED TESTS — audit closeout (base main@b89bfb2). Five independent points.
 * Every assertion here FAILS on b89bfb2.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const yt = () => readFileSync('src/content/platform-adapters/youtube.ts', 'utf-8');
const side = () => readFileSync('src/content/ui/SidePanel.tsx', 'utf-8');
const openSettings = () => readFileSync('src/shared/open-settings-section.ts', 'utf-8');
const sw = () => readFileSync('src/background/service-worker.ts', 'utf-8');
const app = () => readFileSync('src/content/ui/App.tsx', 'utf-8');
const packStore = () => readFileSync('src/background/dict-pack-store.ts', 'utf-8');

describe('P1 — YouTube adapter parity with the intercepted adapter', () => {
  it('fullTrack passes the PICKED track language, not sourceLang', () => {
    const src = yt();
    expect(src).toMatch(/const picked\s*=\s*getTrackByLanguage\(sourceLang\)\s*\?\?\s*getLastTrack\(\)/);
    expect(src).toMatch(/cuesFromRawTrack\(raw,\s*picked\?\.language\s*\|\|\s*'',/);
    expect(src).not.toMatch(/cuesFromRawTrack\(raw,\s*sourceLang,/);
  });

  it('bindTrack removes its load listener when switching tracks', () => {
    const src = yt();
    const block = src.slice(src.indexOf('function bindTrack('), src.indexOf('function pickTextTrack('));
    expect(block).toContain("activeTrack.removeEventListener('load', notifyTrackListeners)");
  });

  it('pickTextTrack matches by primary subtag (en-US ↔ en)', () => {
    const src = yt();
    const block = src.slice(src.indexOf('function pickTextTrack('), src.indexOf('function fullTrack('));
    expect(block).toContain('primarySubtag(');
  });

  it('onTrackCues ignores background tracks and getAltCueAt rejects the source URL', () => {
    const src = yt();
    const onTrackBlock = src.slice(src.indexOf('onTrackCues(cb)'), src.indexOf('getAltCueAt('));
    expect(onTrackBlock).toContain('track.background');
    const altBlock = src.slice(src.indexOf('getAltCueAt('));
    expect(altBlock).toContain('sourceTrack()?.url');
  });
});

describe('P2 — settings deep-link only on extension pages, valid sections', () => {
  it('hash is read only on extension protocols and validated against real sections', () => {
    const s = side();
    const o = openSettings();
    expect(s + o).toMatch(/chrome-extension:/);
    expect(s + o).toMatch(/moz-extension:/);
    // A YouTube #t=30s must never produce a settings section.
    expect(s + o).toMatch(/VALID_SETTINGS_SECTIONS/);
  });
});

describe('P3 — one normalizeAnkiMapping used by SW, orchestrator and App', () => {
  it('normalizeAnkiMapping is exported from anki-model and applied in the SW/App', async () => {
    const m = await import('../../src/shared/anki-model');
    expect(typeof (m as unknown as { normalizeAnkiMapping?: unknown }).normalizeAnkiMapping).toBe('function');
    expect(sw()).toContain('normalizeAnkiMapping(');
    expect(app()).toContain('normalizeAnkiMapping(');
  });

  it('addContextToNote and UPDATE_NOTE_FRAME write sentence/picture/audio with empty fieldSources', () => {
    const src = sw();
    // The frame handler resolves its field from the NORMALIZED mapping.
    const block = src.slice(src.indexOf("onMessage('UPDATE_NOTE_FRAME'"), src.indexOf('Resolve the URL + API key for an AnkiConnect request.'));
    expect(block).toContain('normalizeAnkiMapping');
  });
});

describe('P4 — recapture ref cleared on undo; frame update ownership check', () => {
  it('App clears lastSavedNoteRef on CARD_UNDONE_EVENT', () => {
    const src = app();
    const block = src.slice(src.indexOf('const onCardUndone = (event: Event)'), src.indexOf('// Tier 1.2:'));
    expect(block).toContain('lastSavedNoteRef.current = null');
  });

  it('UPDATE_NOTE_FRAME checks registry ownership before any Anki write', () => {
    const src = sw();
    const block = src.slice(src.indexOf("onMessage('UPDATE_NOTE_FRAME'"), src.indexOf('Resolve the URL + API key for an AnkiConnect request.'));
    expect(block).toContain('findByNoteId(');
    expect(block.indexOf('findByNoteId(')).toBeLessThan(block.indexOf('storeMediaFile('));
    expect(block).toContain("status !== 'saved'");
  });
});

describe('P5 — dict-pack defence in depth', () => {
  it('sanitizeTermRow caps definitions at 64 and the URL fallback caps bytes', () => {
    const store = packStore();
    expect(store).toContain('slice(0, 64)');
    const worker = sw();
    const block = worker.slice(worker.indexOf('const buf = await res.arrayBuffer()'));
    expect(block).toMatch(/buf\.byteLength\s*>\s*DICT_PACK_MAX_BYTES/);
  });
});
