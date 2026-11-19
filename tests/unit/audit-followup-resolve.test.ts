/**
 * RED TESTS — the new non-hook resolver seam and canonical lemma tag in queries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('resolveContextGloss (shared by every save path)', () => {
  it('uses the RESOLVE_WORD local entry translation', async () => {
    let waves: unknown[] = [{ stage: 'local', entry: { token: 'run', type: 'word', translation: 'dirigir' } }];
    const sendMessage = vi.fn(async () => ({ ok: true, waves }));
    vi.doMock('webext-bridge/content-script', () => ({ sendMessage }));
    vi.doMock('../../src/content/nlp/dictionary', () => ({
      lookupDictionary: vi.fn(() => ({ token: 'run', type: 'word', translation: 'correr' })),
    }));
    const { resolveContextGloss } = await import('../../src/content/resolve-context-gloss');
    await expect(resolveContextGloss('run', 'She runs the company.', 'en')).resolves.toEqual({ gloss: 'dirigir' });
    expect(sendMessage).toHaveBeenCalledWith(
      'RESOLVE_WORD',
      { token: 'run', sentence: 'She runs the company.', sourceLang: 'en' },
      'background',
    );
    waves = [{ stage: 'local', entry: { token: 'run', type: 'word', translation: '—' } }];
    await expect(resolveContextGloss('run', 'She runs.', 'en')).resolves.toEqual({ gloss: 'correr' });
  });
});

describe('buildIdentityNoteQuery uses the canonical lemma tag', () => {
  it('normalizes a non-normalized key through lemmaTag()', async () => {
    const { buildIdentityNoteQuery } = await import('../../src/shared/anki-search');
    const q = buildIdentityNoteQuery({
      deckName: 'D', identityKey: 'Rock’N’Roll ', surface: 'Rock’n’Roll',
    });
    expect(q).toContain('tag:kivara::lemma::rock\'n\'roll');
    expect(q).toContain('"Front:Rock’n’Roll"');
  });
});
