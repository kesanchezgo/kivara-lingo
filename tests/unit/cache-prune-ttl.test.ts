/**
 * The pruner honors the user's TTL — the regression this file exists for.
 *
 * "How long is a cached row current?" is ONE question with TWO answers, and
 * both answers were wrong in turn: first the reader used `cacheTtlDays ?? 14`
 * while the pruner baked in 30 (rows deleted before their TTL for a lifetime),
 * then a fix lowered the pruner to the reader's 14 instead of raising the
 * reader (rows configured for 30 deleted at 14). `pruneVipCache` now takes
 * the EFFECTIVE ttl, threaded through `writeEnrichmentCache`, and the reader
 * and the pruner finally answer it with the same number.
 *
 * The stub table records what the `below(threshold).delete()` collected — so
 * these cases assert the WINDOW, not the delete bookkeeping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AiExplainRequest, AiSettings } from '../../src/shared/types';
import { explainCacheKey } from '../../src/background/ai-explain-core';

interface Row {
  key: string;
  payload: unknown;
  storedAt: number;
}

const DAY = 24 * 3600 * 1000;

let expiredDeletes: Row[] = [];

function installPruneRecorder(rows: Row[]): void {
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      vip_cache: {
        toArray: async () => rows,
        count: async () => rows.length,
        put: async (r: Row) => { rows.push(r); },
        bulkDelete: async (keys: string[]) => {
          for (const r of rows) if (keys.includes(r.key)) r.storedAt = -1;
        },
        where: () => ({
          below: (threshold: number) => ({
            delete: async () => {
              expiredDeletes = rows.filter((r) => r.storedAt < threshold).slice();
              return expiredDeletes.length;
            },
          }),
        }),
        orderBy: () => ({
          reverse: () => ({
            offset: () => ({ primaryKeys: async () => [] as string[] }),
          }),
        }),
      },
    }),
  }));
}

const AGO_20 = { key: 'stored20', payload: { entry: null }, storedAt: 0 };

function freshRows(): Row[] {
  const now = Date.now();
  return [{ ...AGO_20, storedAt: now - 20 * DAY }];
}

const write = async (ttlDays?: number) => {
  const mod = await import('../../src/background/enrichment/cache');
  if (ttlDays === undefined) return mod.writeEnrichmentCache('k', { entry: null } as never);
  return mod.writeEnrichmentCache('k', { entry: null } as never, ttlDays);
};

describe('prune honors the effective TTL', () => {
  beforeEach(() => {
    vi.resetModules();
    expiredDeletes = [];
  });

  afterEach(() => {
    vi.doUnmock('../../src/shared/db');
  });

  it('deletes a 20-day row at the 14-day default', async () => {
    installPruneRecorder(freshRows());
    await write();
    expect(expiredDeletes.map((r) => r.key)).toContain('stored20');
  });

  it('keeps a 20-day row when cacheTtlDays is 30', async () => {
    // THE regression: a row the user configured to live for 30 days was
    // deleted by a pruner that never heard about the 30.
    installPruneRecorder(freshRows());
    await write(30);
    expect(expiredDeletes.map((r) => r.key)).not.toContain('stored20');
  });

  it('survives a NEGATIVE ttl: the young row stays, the ceiling still prunes', async () => {
    // The UI guard `Number(v) || 14` catches 0 and NaN but lets a typed `-5`
    // through. A negative ttl computes a PRUNE THRESHOLD ABOVE `now`, so the
    // pruner's `below(...)` deletes EVERY row and the reader calls every row
    // stale — the whole cache gone because someone typed a dash.
    installPruneRecorder([
      { key: 'anHourOld', payload: { entry: null }, storedAt: Date.now() - 3600_000 },
      { key: 'veryOld', payload: { entry: null }, storedAt: Date.now() - 40 * DAY },
    ]);
    await write(-5);
    // The clamp is to the DEFAULT 14: young survives, past-ceiling dies —
    // so the window moved to the default instead of wiping the table.
    expect(expiredDeletes.map((r) => r.key)).toEqual(['veryOld']);
  });
  it('deletes a 20-day row when the effective TTL is 14', async () => {
    // Same row, explicit 14: the window is a parameter in both directions.
    installPruneRecorder(freshRows());
    await write(14);
    expect(expiredDeletes.map((r) => r.key)).toContain('stored20');
  });
});

/* ─── explain_cache prunes in the same pass ─────────────────────────────── */

interface ExplainRow {
  key: string;
  data: unknown;
  expiresAt: number;
}

let explainDeletedKeys: string[] = [];

/**
 * Recorder for BOTH tables of the shared pass: the vip sweep's
 * `below(storedAt)` window and the explain sweep's `belowOrEqual(expiresAt)`
 * delete, which physically removes the doomed rows.
 */
function installPassRecorders(vipRows: Row[], explainRows: ExplainRow[]): void {
  vi.doMock('../../src/shared/db', () => ({
    getDB: () => ({
      vip_cache: {
        toArray: async () => vipRows,
        count: async () => vipRows.length,
        put: async (r: Row) => {
          vipRows.push(r);
        },
        bulkDelete: async () => {},
        where: () => ({
          below: (threshold: number) => ({
            delete: async () => {
              expiredDeletes = vipRows.filter((r) => r.storedAt < threshold).slice();
              return expiredDeletes.length;
            },
          }),
        }),
        orderBy: () => ({
          reverse: () => ({
            offset: () => ({ primaryKeys: async () => [] as string[] }),
          }),
        }),
      },
      explain_cache: {
        where: () => ({
          belowOrEqual: (threshold: number) => ({
            delete: async () => {
              const doomed = explainRows.filter((r) => r.expiresAt <= threshold);
              for (const r of doomed) explainRows.splice(explainRows.indexOf(r), 1);
              explainDeletedKeys.push(...doomed.map((r) => r.key));
              return doomed.length;
            },
          }),
        }),
      },
    }),
  }));
}

describe('explain_cache prunes in the same pass', () => {
  beforeEach(() => {
    vi.resetModules();
    expiredDeletes = [];
    explainDeletedKeys = [];
  });

  afterEach(() => {
    vi.doUnmock('../../src/shared/db');
  });

  it('deletes the expired row and keeps the fresh one', async () => {
    const now = Date.now();
    const rows: ExplainRow[] = [
      { key: 'stale-explain', data: { meaning: 'old' }, expiresAt: now - 1 },
      { key: 'fresh-explain', data: { meaning: 'new' }, expiresAt: now + DAY },
    ];
    installPassRecorders([], rows);
    const mod = await import('../../src/background/enrichment/cache');
    await mod.pruneExpiredCaches();
    expect(explainDeletedKeys).toContain('stale-explain');
    expect(explainDeletedKeys).not.toContain('fresh-explain');
    expect(rows.map((r) => r.key)).toEqual(['fresh-explain']);
  });

  it('sweeps explain rows when the ENRICHMENT write fires the pass', async () => {
    // One pass, two tables: the write path of the enrichment cache must not
    // leave the explain bucket unpruned.
    const rows: ExplainRow[] = [
      { key: 'stale-via-write', data: { meaning: 'old' }, expiresAt: Date.now() - 1 },
    ];
    installPassRecorders([{ key: 'vip1', payload: { entry: null }, storedAt: Date.now() }], rows);
    const mod = await import('../../src/background/enrichment/cache');
    await mod.writeEnrichmentCache('k', { entry: null } as never);
    // The pass is fired voided by the write path; drain the microtask queue.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(explainDeletedKeys).toContain('stale-via-write');
  });

  it('shares the 5-minute cadence with the vip sweep', async () => {
    const rows: ExplainRow[] = [
      { key: 'stale-explain', data: { meaning: 'old' }, expiresAt: Date.now() - 1 },
    ];
    installPassRecorders([], rows);
    const mod = await import('../../src/background/enrichment/cache');
    await mod.pruneExpiredCaches();
    expect(explainDeletedKeys).toEqual(['stale-explain']);
    // A row that expired after the pass ran waits for the next window, just
    // like a vip row written after its sweep does.
    rows.push({ key: 'second-stale', data: { meaning: 'old' }, expiresAt: Date.now() - 1 });
    await mod.pruneExpiredCaches();
    expect(explainDeletedKeys).toEqual(['stale-explain']);
    expect(expiredDeletes).toEqual([]);
  });
});

describe('a stale explain row is not served after pruning', () => {
  const EXPLAIN_SETTINGS: AiSettings = {
    provider: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    enrichOnSave: false,
    enrichOnHover: false,
    cacheTtlDays: 30,
    preferAiMnemonic: true,
    preferAiEtymology: true,
    enableDalleFallback: false,
  };

  const EXPLAIN_REQ: AiExplainRequest = {
    prev: 'I told you.',
    line: 'Where were you last night?',
    next: 'Nothing, I swear.',
    lang: 'en',
    uiLang: 'es',
    nativeLang: 'es',
  };

  function openAiEnvelope(text: string): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  /**
   * The F7 wiring's install(): fake settings, fake store, and a DB whose
   * `explain_cache` supports the read path AND the prune sweep.
   */
  function installExplainPath(rows: ExplainRow[]): { deletedKeys: string[] } {
    const deletedKeys: string[] = [];
    vi.doMock('../../src/background/ai-enrich', () => ({
      getAiSettings: async () => EXPLAIN_SETTINGS,
      getResolvedNativeLang: async () => 'es',
    }));
    vi.doMock('../../src/shared/store', () => ({ DEFAULT_AI: { cacheTtlDays: 30 } }));
    vi.doMock('../../src/shared/db', () => ({
      getDB: () => ({
        explain_cache: {
          get: async (key: string) => rows.find((r) => r.key === key),
          put: async (row: ExplainRow) => {
            const at = rows.findIndex((r) => r.key === row.key);
            if (at >= 0) rows[at] = row;
            else rows.push(row);
          },
          where: () => ({
            belowOrEqual: (threshold: number) => ({
              delete: async () => {
                const doomed = rows.filter((r) => r.expiresAt <= threshold);
                for (const r of doomed) rows.splice(rows.indexOf(r), 1);
                deletedKeys.push(...doomed.map((r) => r.key));
                return doomed.length;
              },
            }),
          }),
        },
      }),
    }));
    return { deletedKeys };
  }

  beforeEach(() => {
    vi.resetModules();
    expiredDeletes = [];
    explainDeletedKeys = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../../src/shared/db');
    vi.doUnmock('../../src/shared/store');
    vi.doUnmock('../../src/background/ai-enrich');
  });

  it('prunes the stale row, then the provider answers instead of the cache', async () => {
    const keyOf = (req: AiExplainRequest) =>
      explainCacheKey(
        EXPLAIN_SETTINGS.provider,
        EXPLAIN_SETTINGS.model,
        EXPLAIN_SETTINGS.baseUrl ?? '',
        req.lang ?? '',
        req.uiLang,
        req.nativeLang,
        req.prev,
        req.line,
        req.next,
      );
    const rows: ExplainRow[] = [
      {
        key: keyOf(EXPLAIN_REQ),
        data: { meaning: 'STALE ANSWER', grammar: '', expressions: [], sound: [] },
        expiresAt: Date.now() - 1,
      },
      {
        key: keyOf({ ...EXPLAIN_REQ, prev: undefined, next: undefined, line: 'a fresh line' }),
        data: { meaning: 'FRESH ANSWER', grammar: '', expressions: [], sound: [] },
        expiresAt: Date.now() + DAY,
      },
    ];
    const { deletedKeys } = installExplainPath(rows);

    const cacheMod = await import('../../src/background/enrichment/cache');
    await cacheMod.pruneExpiredCaches();
    // The stale row is physically gone, the fresh one survived the sweep.
    expect(deletedKeys).toContain(keyOf(EXPLAIN_REQ));
    expect(rows.find((r) => r.key === keyOf(EXPLAIN_REQ))).toBeUndefined();

    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        openAiEnvelope(JSON.stringify({ meaning: 'NEW ANSWER', expressions: [], sound: [] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { explainSentence } = await import('../../src/background/ai-explain');

    const result = await explainSentence(EXPLAIN_REQ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Not served from the cache — the pruned row cannot answer, the provider did.
    expect(result.cached).toBe(false);
    expect(result.data.meaning).toBe('NEW ANSWER');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The fresh row is still served without a second provider call.
    const fresh = await explainSentence({
      ...EXPLAIN_REQ,
      prev: undefined,
      next: undefined,
      line: 'a fresh line',
    });
    expect(fresh.ok && fresh.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
