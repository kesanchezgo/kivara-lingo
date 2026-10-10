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
 *
 * There is deliberately NO `vitest-*` branch: `vitest-mock` is a real package
 * shape that is not this framework, and the second alternative is what made the
 * one-dash negative look random (it only passed because it doubled the dash).
 */
const VITEST_IMPORT =
  /(?:from|import\s*\(?|require\s*\(|(?:vi|vitest)\.mock\()\s*["'](?:@vitest|vitest)(?:\/[^"']*)?["']/;

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
      "vitest.mock('vitest', () => ({}))",
    ]) {
      expect(VITEST_IMPORT.test(source), source).toBe(true);
    }
  });

  it('does not flag look-alikes', () => {
    for (const source of [
      "const toolName = 'vitest-runner';",
      "const word = 'notvitestInQuotes';",
      "from './vitest-helper';",
      "from 'vitest-library-shim';",
      "from 'vitest-mock';",
      "const x = 'from' + ' ' + 'vitest-noop';",
    ]) {
      expect(VITEST_IMPORT.test(source), source).toBe(false);
    }
  });

  it('a commented-out `//` import is ignored', () => {
    // Stale `//` comments are exactly what removing an import leaves behind.
    const commented = "// it used to import { describe } from 'vitest'";
    expect(VITEST_IMPORT.test(commented)).toBe(true);
    expect(VITEST_IMPORT.test(stripComments(commented))).toBe(false);
  });

  it('a block comment on the same line as a real import does NOT hide it', () => {
    // A guard erring towards silence hides real bugs; erring towards noise
    // costs one review comment. Block comments are therefore not stripped, so
    // `/* x */ import … from 'vitest'` is still a hit.
    const source = "/* placeholder */ import { x } from 'vitest';";
    expect(stripComments(source)).toBe(source);
    expect(VITEST_IMPORT.test(stripComments(source))).toBe(true);
  });

  it('stripping leaves a glob inside a string alone', () => {
    const withGlob = "const glob = 'src/**/*.ts';";
    expect(stripComments(withGlob)).toContain('src/**/*.ts');
  });
});

/**
 * Remove WHOLE `//` comment lines only. Block comments are deliberately left
 * in place: a stray `/*` inside a string would otherwise eat everything up to
 * the next close and hide a real import, and a false positive on a commented
 * block costs a review comment rather than a missed violation.
 */
function stripComments(text: string): string {
  return text.replace(/^[ \t]*\/\/.*$/gm, '');
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
