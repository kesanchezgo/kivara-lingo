/**
 * The permission gate, exercised without a service worker.
 *
 * The invariants: a source whose OPTIONAL origins are not granted is skipped and
 * REPORTED (never fired, never thrown); a source with no network reach is never
 * gated; and the whole decision is one browser listing, which `splitByPermission`
 * makes testable as a pure function of a granted list.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SOURCE_PERMISSION_GROUP,
  originsForSource,
  splitByPermission,
  gateSources,
} from '../../src/background/enrichment/permissions-gate';
import type { EnrichmentSource } from '../../src/background/enrichment/types';

/** A source stub shaped like the real one: an id and an enrich(). */
function src(id: string): EnrichmentSource {
  return {
    id,
    label: id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    enrich: async () => ({}) as never,
  } as unknown as EnrichmentSource;
}

describe('SOURCE_PERMISSION_GROUP', () => {
  it('covers the network sources and skips the local ones', () => {
    expect(SOURCE_PERMISSION_GROUP.cambridge).toBe('dict:cambridge');
    expect(SOURCE_PERMISSION_GROUP.oxfordLearners).toBe('dict:oxford');
    // Bundled dictionaries and Yomitan packs are files on disk: they must never
    // be gated or a user with every origin revoked loses the whole dictionary.
    expect(SOURCE_PERMISSION_GROUP.bundled).toBeUndefined();
    expect(SOURCE_PERMISSION_GROUP.yomitanPacks).toBeUndefined();
  });

  it('maps an ungated source to no origins at all', () => {
    expect(originsForSource('bundled')).toEqual([]);
    expect(originsForSource('nope')).toEqual([]);
    expect(originsForSource('cambridge').length).toBeGreaterThan(0);
  });
});

describe('splitByPermission', () => {
  const cambridgeOrigins = originsForSource('cambridge');

  it('holds a source back when NONE of its group is granted', () => {
    const result = splitByPermission([src('cambridge'), src('bundled')], []);
    expect(result.reachable.map((s) => s.id)).toEqual(['bundled']);
    expect(result.needsAccess).toEqual([{ source: 'cambridge', group: 'dict:cambridge' }]);
  });

  it('holds a PARTIALLY granted group back (one pattern is not enough)', () => {
    // `dict:merriam` declares two DISTINCT hosts; granting only the first must
    // not make the source reachable, because matching is origin-by-origin —
    // `*.selfHost` does not stand in for `otherHost`.
    const merriam = originsForSource('merriamWebster');
    expect(merriam.length).toBeGreaterThan(1);
    const result = splitByPermission([src('merriamWebster')], [merriam[0]]);
    expect(result.reachable).toEqual([]);
    expect(result.needsAccess.map((n) => n.source)).toEqual(['merriamWebster']);
  });

  it('takes a granting of the whole group', () => {
    const merriam = originsForSource('merriamWebster');
    const result = splitByPermission([src('merriamWebster')], merriam);
    expect(result.needsAccess).toEqual([]);
    expect(result.reachable.map((s) => s.id)).toEqual(['merriamWebster']);
  });

  it('keeps order and reports local sources as neither', () => {
    const result = splitByPermission(
      [src('bundled'), src('yomitanPacks'), src('cambridge'), src('forvo')],
      [],
    );
    expect(result.reachable.map((s) => s.id)).toEqual(['bundled', 'yomitanPacks']);
    expect(result.needsAccess.map((n) => n.source)).toEqual(['cambridge', 'forvo']);
  });

  it('an unlisted source is reachable (no group means no network)', () => {
    // A source absent from the table is treated as needing nothing, which is
    // also what a future local source expects.
    const result = splitByPermission([src('unlisted')], []);
    expect(result.needsAccess).toEqual([]);
    expect(result.reachable.map((s) => s.id)).toEqual(['unlisted']);
  });

  it('a wildcard grant covers the apex of its host', () => {
    // `matchesPattern` treats `*.dictionary.cambridge.org` as covering the
    // apex, so the group's apex pattern is satisfied by the wildcard pattern.
    const result = splitByPermission([src('cambridge')], [
      'https://*.dictionary.cambridge.org/*',
    ]);
    expect(result.needsAccess).toEqual([]);
    expect(result.reachable.map((s) => s.id)).toEqual(['cambridge']);
  });
});

describe('gateSources', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('issues ONE listing for the whole lookup', async () => {
    const getAll = vi.fn(async () => ({ origins: [] as string[] }));
    vi.stubGlobal('chrome', { permissions: { getAll, contains: async () => true } });
    await gateSources([src('cambridge'), src('forvo'), src('bundled')]);
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('gates nothing without a permissions API (unit tests, plain pages)', async () => {
    vi.stubGlobal('chrome', undefined);
    const result = await gateSources([src('cambridge')]);
    expect(result.needsAccess).toEqual([]);
    expect(result.reachable.map((s) => s.id)).toEqual(['cambridge']);
  });
});
