/**
 * Regression tests for the 03624fc review (2026-10-08):
 *  - addNote passes a 15 s timeout when fields carry [sound:]/<img> refs
 *    (the single-upload rule emptied note.audio/picture, so the old array
 *    gate never triggered and media notes timed out at 4 s → duplicates).
 *    We fake timers so the abort fires instantly and assert on the
 *    recorded setTimeout delay + the error message budget.
 *  - Manifest stays within Chrome's 4-suggested-shortcut cap
 *    (recapture_frame ships with NO suggested_key; Alt+V is in-page only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('anki media timeout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function budgetFor(fields: Record<string, string>): Promise<number> {
    const delays: number[] = [];
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      if (typeof ms === 'number') delays.push(ms);
      // Never fire — the assertion below only needs the RECORDED delay.
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    // fetch resolves immediately with a valid AnkiConnect envelope; the
    // abort timer never gets to fire, so the call succeeds fast.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: 123, error: null }),
      })),
    );

    const { ankiConnect } = await import('../../src/background/anki-connect');
    const noteId = await ankiConnect.addNote(
      { deckName: 'd', modelName: 'm', fields },
      'http://127.0.0.1:8765',
    );
    expect(noteId).toBe(123);
    timeoutSpy.mockRestore();
    // The abort budget is the FIRST setTimeout recorded (invokeOnce arms it
    // before fetch). Later timers (none here) are irrelevant.
    return delays[0];
  }

  it('uses the 15 s budget when fields carry media references', async () => {
    const budget = await budgetFor({
      Front: 'hola',
      Audio: '[sound:kivara-hola.mp3]',
      Picture: '<img src="kivara-hola.jpg">',
    });
    expect(budget).toBe(15000);
  });

  it('keeps the 4 s budget for text-only notes', async () => {
    const budget = await budgetFor({ Front: 'hola' });
    expect(budget).toBe(4000);
  });
});

describe('manifest suggested_key cap', () => {
  it('declares at most 4 suggested shortcuts', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'manifest.json'), 'utf8'),
    ) as { commands: Record<string, { suggested_key?: unknown }> };
    const withKeys = Object.entries(manifest.commands).filter(([, c]) => c.suggested_key);
    expect(withKeys.length).toBeLessThanOrEqual(4);
    // recapture_frame must stay keyless (in-page Alt+V only).
    expect(manifest.commands.recapture_frame?.suggested_key).toBeUndefined();
  });
});
