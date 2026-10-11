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

  it('deletes a 20-day row when the effective TTL is 14', async () => {
    // Same row, explicit 14: the window is a parameter in both directions.
    installPruneRecorder(freshRows());
    await write(14);
    expect(expiredDeletes.map((r) => r.key)).toContain('stored20');
  });
});
