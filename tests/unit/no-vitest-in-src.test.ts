/**
 * Production code must not import the test framework.
 *
 * It happened once: a spec was extracted into a production module and the
 * `import { describe, it, expect } from 'vitest'` line rode along. The build
 * passed — Rollup drops unused imports from an entry that never calls them —
 * so the offending code shipped green and the mistake was invisible until a
 * human read the file. A grep-scale check costs nothing and catches the class.
 *
 * The check is a plain file walk on purpose: no lint plugin, no config, and it
 * runs the same way in CI and locally.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

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
      .filter((file) => /from\s+['"]vitest['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
