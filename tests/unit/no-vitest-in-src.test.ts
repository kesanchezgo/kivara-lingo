/**
 * Production code must not import the test framework.
 *
 * It happened once: a spec was extracted into a production module and the
 * `import { describe, it, expect } from 'vitest'` line rode along. The build
 * passed — Rollup drops unused imports from an entry that never calls them —
 * so the offending code shipped green and the mistake was invisible until a
 * human read the file. A grep-scale check costs nothing and catches the class.
 *
 * The regex covers every way a package can be pulled in, not just `from`:
 * import declarations, dynamic `import()`, side-effect `import 'pkg'`,
 * `require`, and the `@vitest/*` / `vitest/*` sub-paths.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

/** Any form of pulling in the test framework, with or without a sub-path. */
const VITEST_IMPORT =
  /(?:from\s*|import\s*\(?\s*["']|require\s*\(\s*["']|^import\s+)["']@?vitest(?:\/[^"']*)?["']/m;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no test imports in production sources', () => {
  it('imports nothing from vitest', () => {
    const offenders = walk(SRC)
      .filter((file) => VITEST_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
