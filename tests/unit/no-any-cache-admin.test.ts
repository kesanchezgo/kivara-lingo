/**
 * The last `any`s in the cache stack stay gone.
 *
 * `cache-admin.ts` shipped with a loosely-typed `tableStats(table: any, …)`
 * and two `(getDB() as any)` casts, and `forvo.ts` reached `atob` through
 * `(globalThis as any)` — all three are typed against `KivaraDB` / a guarded
 * global lookup now. This suite pins the rule the same way
 * `i18n-no-literals.test.ts` pins the no-hardcoded-copy rule: it scans the
 * two sources for every shape an `any` leaks through — a cast (`as any`),
 * an annotation (`: any`) and a type argument (`<any>`) — and the fixtures
 * live in the test itself, so the detector's shapes are exercised even while
 * the scanned files are clean.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCES = [
  'src/background/cache-admin.ts',
  'src/background/enrichment/sources/forvo.ts',
];

/** The three shapes an `any` leaks through: cast, annotation, type argument. */
const ANY_RE = /\bas\s+any\b|:\s*any\b|<any>/;

/**
 * Report every line of `src` carrying an `any` shape. Comment lines are
 * skipped — prose that merely SAYS "any" ("passes from any browser-like
 * fingerprint") is not a cast. Exported so the fixtures below can drive the
 * detector directly instead of trusting the repository scan to exercise it.
 */
export function findAnys(src: string): string[] {
  return src
    .split('\n')
    .map((line, i) => ({ no: i + 1, line }))
    .filter(({ line }) => {
      const stripped = line.trim();
      if (
        stripped.startsWith('//') ||
        stripped.startsWith('*') ||
        stripped.startsWith('/*')
      ) {
        return false;
      }
      return ANY_RE.test(line);
    })
    .map(({ no, line }) => `${no}: ${line.trim()}`);
}

describe('no `any` in cache-admin / forvo', () => {
  it('scans both files clean', () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      for (const hit of findAnys(readFileSync(file, 'utf8'))) {
        offenders.push(`${file} ${hit}`);
      }
    }
    expect(offenders, '`any` left behind:\n' + offenders.join('\n')).toEqual([]);
  });

  it('flags the cast, annotation and type-argument shapes', () => {
    // Must fail: the exact shapes the three bugs shipped as.
    expect(findAnys('const db = getDB() as any;')).toHaveLength(1);
    expect(findAnys('async function tableStats(table: any) {}')).toHaveLength(1);
    expect(findAnys('const rows: Array<any> = [];')).toHaveLength(1);

    // Must pass: prose, identifiers and type names that merely contain "any".
    expect(findAnys('// passes from any browser-like fingerprint')).toEqual([]);
    expect(findAnys('const anything = 1;')).toEqual([]);
    expect(findAnys('const xs: Array<unknown> = [];')).toEqual([]);
    expect(findAnys('type Box = { value: Any; };')).toEqual([]);
  });
});
