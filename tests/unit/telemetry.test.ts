/**
 * Telemetry unit tests.
 *
 * The telemetry module is plain functions on top of a tiny Dexie table.
 * We mock the DB layer so the tests stay synchronous and don't depend on
 * IndexedDB being available in happy-dom (it isn't, fully).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackStatsRow } from '../../src/shared/db';

interface FakeTable {
  get(id: string): Promise<PackStatsRow | undefined>;
  put(row: PackStatsRow): Promise<string>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  toArray(): Promise<PackStatsRow[]>;
}

function makeFakeTable(): FakeTable {
  const map = new Map<string, PackStatsRow>();
  return {
    async get(id) {
      return map.get(id);
    },
    async put(row) {
      map.set(row.packId, row);
      return row.packId;
    },
    async delete(id) {
      map.delete(id);
    },
    async clear() {
      map.clear();
    },
    async toArray() {
      return Array.from(map.values());
    },
  };
}

const fakeTable = makeFakeTable();

vi.mock('../../src/shared/db', () => ({
  getDB: () => ({ pack_stats: fakeTable }),
}));

import {
  BUNDLE_PACK_ID,
  MISS_PACK_ID,
  REMOTE_PACK_ID,
  aggregateCoverage,
  deletePackStats,
  isTelemetryEnabled,
  readPackStats,
  recordLookupHit,
  recordMiss,
  recordPackInstall,
  resetCoverage,
  setTelemetryEnabled,
} from '../../src/shared/telemetry';

describe('telemetry', () => {
  beforeEach(async () => {
    await fakeTable.clear();
    setTelemetryEnabled(true);
  });

  it('records pack installs idempotently', async () => {
    await recordPackInstall('pack-abc', 'Test pack');
    await recordPackInstall('pack-abc', 'Test pack');
    const rows = await readPackStats();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ packId: 'pack-abc', hits: 0 });
  });

  it('increments hit counter on each successful lookup', async () => {
    await recordPackInstall('pack-abc');
    await recordLookupHit('pack-abc');
    await recordLookupHit('pack-abc');
    await recordLookupHit('pack-abc');
    const rows = await readPackStats();
    expect(rows.find((r) => r.packId === 'pack-abc')?.hits).toBe(3);
  });

  it('counts misses under the synthetic MISS_PACK_ID', async () => {
    await recordMiss();
    await recordMiss();
    const rows = await readPackStats();
    expect(rows.find((r) => r.packId === MISS_PACK_ID)?.hits).toBe(2);
  });

  it('keeps bundle / remote / miss / pack hits in separate buckets', async () => {
    await recordLookupHit(BUNDLE_PACK_ID);
    await recordLookupHit(BUNDLE_PACK_ID);
    await recordLookupHit(REMOTE_PACK_ID);
    await recordLookupHit('pack-yomitan');
    await recordMiss();
    const rows = await readPackStats();
    const totals = aggregateCoverage(rows);
    expect(totals.bundleHits).toBe(2);
    expect(totals.remoteHits).toBe(1);
    expect(totals.packHits).toBe(1);
    expect(totals.misses).toBe(1);
    expect(totals.total).toBe(5);
    expect(totals.localCoverage).toBeCloseTo(3 / 5);
  });

  it('returns zero coverage when no lookups have been recorded', () => {
    const totals = aggregateCoverage([]);
    expect(totals.total).toBe(0);
    expect(totals.localCoverage).toBe(0);
  });

  it('deletePackStats removes only the targeted row', async () => {
    await recordLookupHit('pack-abc');
    await recordLookupHit('pack-def');
    await deletePackStats('pack-abc');
    const rows = await readPackStats();
    expect(rows.map((r) => r.packId)).toEqual(['pack-def']);
  });

  it('resetCoverage drops every row', async () => {
    await recordLookupHit('pack-abc');
    await recordLookupHit(BUNDLE_PACK_ID);
    await recordMiss();
    await resetCoverage();
    const rows = await readPackStats();
    expect(rows).toHaveLength(0);
  });

  it('respects the master switch — no-ops when disabled', async () => {
    setTelemetryEnabled(false);
    expect(isTelemetryEnabled()).toBe(false);
    await recordPackInstall('pack-disabled');
    await recordLookupHit('pack-disabled');
    await recordMiss();
    const rows = await readPackStats();
    expect(rows).toHaveLength(0);
  });

  it('updates lastUsedAt on every recorded hit', async () => {
    await recordLookupHit('pack-abc');
    const after = await fakeTable.get('pack-abc');
    const first = after!.lastUsedAt;
    // Ensure the second tick lands on a later timestamp.
    await new Promise((r) => setTimeout(r, 5));
    await recordLookupHit('pack-abc');
    const later = await fakeTable.get('pack-abc');
    expect(later!.lastUsedAt).toBeGreaterThan(first);
  });
});
