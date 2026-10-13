/**
 * The versioned `migrate` hook: model ids the providers retired must be
 * rewritten once, on existing snapshots, and never again.
 *
 * Why it exists: `claude-3-5-haiku-latest`, `claude-3-5-sonnet-latest` and
 * `gemini-2.0-flash` were pulled from the catalogs in 2170b81 — anyone who
 * had one selected kept it in the persisted state and every AI call came
 * back as a 4xx with nothing to show the user.
 *
 * The hook is imported from the store module itself, not mirrored here, so
 * changing the rule in store.ts cannot leave this suite testing a copy.
 */
import { describe, it, expect } from 'vitest';
import { migrateStoreState, STORE_VERSION } from '../../src/shared/store';

type Shape = { state?: { ai?: { model?: string; apiKey?: string; provider?: string } } };

describe('retired AI model migration (store version 1)', () => {
  it('maps every retired id to a live one', () => {
    const cases: Array<[string, string]> = [
      ['claude-3-5-haiku-latest', 'claude-haiku-4-5'],
      ['claude-3-5-sonnet-latest', 'claude-sonnet-4-6'],
      ['gemini-2.0-flash', 'gemini-2.5-flash'],
    ];
    for (const [old, live] of cases) {
      const out = migrateStoreState({ state: { ai: { model: old } } }, 0) as Shape;
      expect(out.state!.ai!.model).toBe(live);
    }
  });

  it('leaves a live id untouched', () => {
    for (const model of ['claude-haiku-4-5', 'claude-opus-4-7', 'gpt-4o', 'gemini-2.5-pro']) {
      const out = migrateStoreState({ state: { ai: { model } } }, 0) as Shape;
      expect(out.state!.ai!.model).toBe(model);
    }
  });

  it('is idempotent — a second pass over a migrated snapshot changes nothing', () => {
    const once = migrateStoreState({ state: { ai: { model: 'claude-3-5-haiku-latest' } } }, 0) as Shape;
    const twice = migrateStoreState(once, 1) as Shape;
    expect(twice.state!.ai!.model).toBe('claude-haiku-4-5');
  });

  it('does not run for a snapshot already at the current version', () => {
    // The user's own later choice lives at fromVersion === STORE_VERSION, so
    // the migration must be a no-op: this is the guard that replaces the old
    // "redecide on every load" behaviour.
    const snapshot: Shape = { state: { ai: { model: 'claude-haiku-4-5' } } };
    const out = migrateStoreState(snapshot, STORE_VERSION) as Shape;
    expect(out).toBe(snapshot);
  });

  it('survives older snapshot shapes', () => {
    expect(migrateStoreState({ state: {} }, 0)).toEqual({ state: {} });
    expect(migrateStoreState({}, 0)).toEqual({});
    expect(migrateStoreState(null, 0)).toBeNull();
    expect(migrateStoreState(undefined, 0)).toBeUndefined();
  });

  it('keeps every other ai field, key included', () => {
    const out = migrateStoreState(
      { state: { ai: { model: 'gemini-2.0-flash', provider: 'google-ai', apiKey: 'AIza-live' } } },
      0,
    ) as Shape;
    expect(out.state!.ai!.model).toBe('gemini-2.5-flash');
    expect(out.state!.ai!.provider).toBe('google-ai');
    expect(out.state!.ai!.apiKey).toBe('AIza-live');
  });

  it('exposes the version zustand records with the snapshot', () => {
    expect(STORE_VERSION).toBe(1);
  });
});
