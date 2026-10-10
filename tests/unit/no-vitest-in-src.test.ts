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

/**
 * Any form of pulling in the test framework, with or without a sub-path.
 * Written WITHOUT a leading anchor and without consuming the opening quote in
 * the same alternation as the closing one: both of those shapes are what made
 * an earlier version blind to `import('vitest')`, where the `import(` prefix
 * swallowed the quote that the closing branch then required again.
 */
/**
 * `vi.mock('vitest')` is the remaining pull-in form: a mocked import never
 * says `from`, so the prefix alternation was extended with it, and the
 * sub-path `vitest/...` too.
 */
const VITEST_IMPORT =
  /(?:from|import\s*\(?|require\s*\(|\.mock\s*\()\s*["']@?vitest(?:\/[^"']*)?["']|from\s+["']vitest(?:-[a-z]+)?["']/;

describe('the vitest-import regex itself', () => {
  it('matches every way a package gets pulled in', () => {
    for (const source of [
      "import { describe } from 'vitest';",
      'import { describe } from "vitest";',
      "  const x = await import('vitest')",
      'await import("vitest/globals")',
      "require('vitest')",
      "import 'vitest/setup';",
      'from \'@vitest/expect\';',
      'import { a } from "@vitest/spy";',
      '  indented `import { x } from \'vitest\'`',
      "vi.mock('vitest', () => ({}))",
    ]) {
      expect(VITEST_IMPORT.test(source), source).toBe(true);
    }
  });

  it('does not flag look-alikes', () => {
    for (const source of [
      "const toolName = 'vitest-runner';",
      "const word = 'notvitestInQuotes';",
      "from './vitest-helper';",
      // A commented-out import left behind by removing one: the FILE-level check
      // strips `//` lines first, so this is a negative for the pattern itself.
      "const x = 'from' + ' ' + 'vitest-noop';",
    ]) {
      expect(VITEST_IMPORT.test(source), source).toBe(false);
    }
  });

  it('a commented-out import is only ignored once comment lines are stripped', () => {
    const commented = "// it used to import { describe } from 'vitest'";
    expect(VITEST_IMPORT.test(commented)).toBe(true);
    // …which is exactly why the per-file scan strips comment lines before
    // asking: a stale commented import IS what gets left behind after one is
    // removed, and it must not trip the guard.
    expect(VITEST_IMPORT.test(stripComments(commented))).toBe(false);
  });
});

/** Remove `//` and `/*…*\/` runs so a commented-out import is not a hit. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

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
      .filter((file) => VITEST_IMPORT.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
