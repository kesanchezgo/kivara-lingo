/**
 * RED TESTS — audit round 4, A4: the Undo guard is strict ALWAYS (not
 * opt-in) and refuses notes older than the row that claims them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface StoredRow {
  id: string;
  word: string;
  sentence: string;
  status: string;
  kind: string;
  deck: string;
  lang: string;
  createdAt: number;
  attempts: number;
  tags: string[];
  noteId?: number;
  [k: string]: unknown;
}

const stored: Record<string, unknown> = {};

function seedRow(overrides: Partial<StoredRow>): void {
  const row: StoredRow = {
    id: 'card-x', word: 'run', sentence: 'She runs it.', status: 'sending',
    kind: 'word', deck: 'English vocab', lang: 'en', createdAt: Date.now(),
    attempts: 0, tags: ['kivara-lingo'], ...overrides,
  };
  stored['kvl:cards.recent'] = [
    ...(((stored['kvl:cards.recent'] as StoredRow[]) ?? []).filter((r) => r.id !== row.id)),
    row,
  ];
}

const MAPPING = {
  deckName: 'English vocab', modelName: 'Basic',
  fieldSources: { Front: 'selection', Translation: 'bilingual', Sentence: 'cue' },
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  for (const k of Object.keys(stored)) delete stored[k];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in stored) out[key] = stored[key];
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => { Object.assign(stored, items); },
      },
    },
  };
});

async function loadUndo() {
  const deleteNote = vi.fn(async () => ({ ok: true }));
  vi.doMock('../../src/background/card-actions', () => ({
    deleteNote, noteOwnership: vi.fn(async () => 'owned'),
    addContextToNote: vi.fn(), browseNote: vi.fn(), wordIntervals: vi.fn(),
  }));
  vi.doMock('../../src/background/capture-orchestrator', () => ({
    createCardFromRequest: vi.fn(), retryPendingNotes: vi.fn(async () => ({ retried: 0, succeeded: 0 })),
  }));
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({ pending_notes: { toArray: async () => [], delete: async () => {}, update: async () => {}, add: async () => {} } }),
  }));
  const { undoDeleteNote } = await import('../../src/background/card-lifecycle');
  return { undoDeleteNote, deleteNote };
}

describe('A4 — Undo guard is strict ALWAYS', () => {
  it('a kivara-tagged note with NO saved registry row is refused (deleteNote 0)', async () => {
    const { undoDeleteNote, deleteNote } = await loadUndo();
    const res = await undoDeleteNote(4242, MAPPING as never);
    expect(res.ok).toBe(false);
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it('a saved row whose noteId is far older than the row is refused (reused note)', async () => {
    seedRow({ id: 'card-old', status: 'saved', noteId: 4242, word: 'run', createdAt: Date.now() });
    const { undoDeleteNote, deleteNote } = await loadUndo();
    const res = await undoDeleteNote(4242, MAPPING as never, { origin: 'undo', cardId: 'card-old' });
    expect(res.ok).toBe(false);
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it('a fresh saved row within 5 minutes still deletes', async () => {
    const nid = Date.now();
    seedRow({ id: 'card-fresh', status: 'saved', noteId: nid, word: 'run', createdAt: nid });
    const { undoDeleteNote, deleteNote } = await loadUndo();
    const res = await undoDeleteNote(nid, MAPPING as never, { origin: 'undo', cardId: 'card-fresh' });
    expect(res.ok).toBe(true);
    expect(deleteNote).toHaveBeenCalled();
  });
});
