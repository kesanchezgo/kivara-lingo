/**
 * The tier map's contract, from the merge's point of view.
 *
 * mergeFields must be tier-aware WITHOUT importing the orchestrator (no
 * cycles, no TDZ at service-worker boot), so source-tiers.ts holds the map
 * on its own. That makes the map and the orchestrator's source table able to
 * drift: a source added to VIP_SOURCES without an entry here would fall into
 * `sourceTier()` returning 'standard', and lose — silently — every
 * first-write-wins field to the free APIs.
 *
 * This test is that tripwire: it FAILS when a source id exists in the tier
 * map but is not under the tier the orchestrator implies (and vice versa),
 * and pins the expectations the merge relies on (Cambridge is editorial, a
 * free API is standard, unknown ids lose).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { sourceTier, sourceTierRank, SOURCE_TIERS } from '../../src/background/enrichment/source-tiers';

describe('source tiers', () => {
  it('covers every source id in sources/, with a valid tier', () => {
    // The drift tripwire the review asked for: the ids the orchestrator can
    // actually build partials for are the `id:` literals of every file in
    // sources/. A source added there without an entry in SOURCE_TIERS would
    // silently lose every first-write-wins field (fallback 'standard'), which
    // is the quiet failure this scan exists to catch.
    const files = execSync('git ls-files src/background/enrichment/sources/*.ts')
      .toString()
      .split(/\r?\n/)
      .filter((entry) => entry.startsWith('src/background/enrichment/sources/')
        && entry.endsWith('.ts'));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const match = text.match(/id:\s*'([^']+)'/);
      if (!match) continue;
      const id = match[1];
      expect(SOURCE_TIERS).toHaveProperty(id);
      expect(['vip', 'editorial', 'standard']).toContain(SOURCE_TIERS[id]);
    }
  });

  it('ranks editorial above standard', () => {
    expect(sourceTier('oxfordLearners')).toBe('editorial');
    expect(sourceTier('bundled')).toBe('standard');
    expect(sourceTierRank('oxfordLearners')).toBeLessThan(sourceTierRank('bundled'));
  });

  it('sends unknown ids to the SAFE default: loses every first-write field', () => {
    expect(sourceTier('someNewSource')).toBe('standard');
  });
});
