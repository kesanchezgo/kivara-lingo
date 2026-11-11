/**
 * Atomic dictionary-pack installs.
 *
 * The import is staged under `tmp-<finalId>` and swapped at COMMIT. These
 * cases pin the three promises that shape makes:
 *   (a) a failed/torn import leaves no visible pack and no orphan rows once
 *       the start-up sweep runs;
 *   (b) a successful import produces exactly ONE pack under the final id,
 *       with the rows that actually landed;
 *   (c) the sweep never touches a committed pack.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDB, tempDictPackId } from '../../src/shared/db';
import {
  appendDictPackTerms,
  beginDictPackImport,
  cleanupDictPackOrphans,
  commitDictPackImport,
} from '../../src/background/dict-pack-store';
import type { DictPackRow, DictTermRow } from '../../src/shared/dict-types';
import { listYomitanPacks } from '../../src/content/nlp/yomitan';

const PACK: DictPackRow = {
  id: 'pack-atomic-test',
  title: 'Atomic test pack',
  revision: '1',
  format: 3,
  sourceLang: 'en',
  targetLang: 'es',
  termCount: 0,
  enabled: true,
  createdAt: 1_700_000_000_000,
};

function termRows(count: number, prefix = 'word'): DictTermRow[] {
  return Array.from({ length: count }, (_, i) => ({
    packId: PACK.id,
    expression: `${prefix}${i}`,
    definitions: [{ gloss: `definition ${i}` }],
    popularity: i,
  }));
}

async function resetDb(): Promise<void> {
  const db = getDB();
  await db.delete();
  await db.open();
}

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  await resetDb();
});

describe('atomic dict-pack import', () => {
  it('leaves no visible pack and no orphan rows when the import never commits', async () => {
    await beginDictPackImport(PACK);
    await appendDictPackTerms(PACK.id, termRows(3));

    // The staging pack exists, but it is not an installed pack.
    const db = getDB();
    expect(await db.dict_packs.count()).toBe(1);
    expect(await db.dict_packs.get(tempDictPackId(PACK.id))).toBeTruthy();
    expect(await db.dict_packs.get(PACK.id)).toBeUndefined();
    expect(await listYomitanPacks()).toEqual([]);

    // Simulate a row from an interrupted pre-staging version: no pack owns it.
    await db.dict_terms.add({
      packId: 'ghost-pack',
      expression: 'ghost',
      definitions: [],
      popularity: 0,
    });

    // The worker restarts and runs the sweep.
    const cleaned = await cleanupDictPackOrphans();
    expect(cleaned).toEqual({ packs: 1, terms: 4 });
    expect(await db.dict_packs.count()).toBe(0);
    expect(await db.dict_terms.count()).toBe(0);
    expect(await listYomitanPacks()).toEqual([]);
  });

  it('commits exactly one pack under the final id with the landed row count', async () => {
    await beginDictPackImport(PACK);
    await appendDictPackTerms(PACK.id, termRows(5));
    const written = await commitDictPackImport(PACK);
    expect(written).toBe(5);

    const db = getDB();
    expect(await db.dict_packs.count()).toBe(1);
    expect(await db.dict_packs.get(tempDictPackId(PACK.id))).toBeUndefined();

    const packs = await listYomitanPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe(PACK.id);
    expect(packs[0].termCount).toBe(5);

    expect(await db.dict_terms.where('packId').equals(PACK.id).count()).toBe(5);
    expect(await db.dict_terms.where('packId').equals(tempDictPackId(PACK.id)).count()).toBe(0);
  });

  it('replaces the previous install atomically on re-import', async () => {
    await beginDictPackImport(PACK);
    await appendDictPackTerms(PACK.id, termRows(4, 'old'));
    await commitDictPackImport(PACK);

    await beginDictPackImport(PACK);
    await appendDictPackTerms(PACK.id, termRows(2, 'new'));
    expect(await commitDictPackImport(PACK)).toBe(2);

    const db = getDB();
    expect(await db.dict_packs.count()).toBe(1);
    expect(await db.dict_terms.where('packId').equals(PACK.id).count()).toBe(2);
    const rows = await db.dict_terms.where('packId').equals(PACK.id).toArray();
    expect(rows.map((r) => r.expression).sort()).toEqual(['new0', 'new1']);
  });

  it('never deletes a committed pack during the start-up sweep', async () => {
    await beginDictPackImport(PACK);
    await appendDictPackTerms(PACK.id, termRows(3));
    await commitDictPackImport(PACK);

    const cleaned = await cleanupDictPackOrphans();
    expect(cleaned).toEqual({ packs: 0, terms: 0 });

    const db = getDB();
    const packs = await listYomitanPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe(PACK.id);
    expect(await db.dict_terms.where('packId').equals(PACK.id).count()).toBe(3);
  });
});