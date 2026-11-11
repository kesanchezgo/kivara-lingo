/**
 * The content-script tree must not value-import the extension's storage
 * modules.
 *
 * In a content script, `IndexedDB` is the STREAMING SITE's database — not the
 * extension's (issue #32). A value import of `shared/db`, or of
 * `shared/telemetry` (the module that owns the `getDB()` calls for
 * `pack_stats`), from `src/content/**` or `src/app/components/**` reaches the
 * page's origin: the data is readable by the site and invisible to the service
 * worker.
 *
 * The H5 `no-restricted-imports` rule in eslint.config.js covers `shared/db`.
 * This test closes the rest:
 *   • `shared/telemetry` — the sibling module the rule never named, which is
 *     exactly how `DictPacksSection` kept writing to the site's `pack_stats`
 *     after the import path was fixed;
 *   • re-exports (`export … from`), not just imports;
 *   • the allowlist itself — an exception that is no longer needed must be
 *     deleted, or it quietly re-permits the bug.
 *
 * Type-only imports are allowed: `import type` is erased at compile time, so it
 * adds no runtime edge to the storage module.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCANNED_DIRS = ['src/content', 'src/app/components'];

/** `shared/db`, `shared/telemetry`, reached by any relative depth. */
const RESTRICTED = /(^|\/)shared\/(db|telemetry)$/;

/**
 * The single exception: the Yomitan module owns the pack tables and is
 * imported only by the service worker and extension pages (onboarding, and
 * type-only from src/ui/ports). Same entry as the eslint H5 ignore list.
 */
const ALLOWED = new Map<string, string>([
  ['src/content/nlp/yomitan.ts', 'worker/extension-page only; see eslint.config.js H5 ignore'],
]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full.replace(/\\/g, '/'));
    }
  }
  return acc;
}

/** Comments and side-effect imports would confuse the statement matcher. */
function prepare(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\bimport\s+['"][^'"]+['"];?/g, '');
}

/**
 * `import`/`export` statements that bring a VALUE across. `import type` and
 * `export type` are erased and stay allowed.
 */
const STATEMENT = /(^|\n)[ \t]*(import|export)[ \t]+(type[ \t]+)?([\s\S]*?)from[ \t]*['"]([^'"]+)['"]/g;

interface ScanResult {
  offenders: string[];
  /** Allowlisted files that still carry a restricted import. */
  usedExceptions: Set<string>;
}

function scan(): ScanResult {
  const offenders: string[] = [];
  const usedExceptions = new Set<string>();
  for (const dir of SCANNED_DIRS) {
    for (const file of sourceFiles(dir)) {
      const text = prepare(readFileSync(file, 'utf8'));
      const hits = [...text.matchAll(STATEMENT)]
        .filter((m) => !m[3] && RESTRICTED.test(m[5]))
        .map((m) => m[5]);
      if (hits.length === 0) continue;
      if (ALLOWED.has(file)) {
        usedExceptions.add(file);
        continue;
      }
      offenders.push(`${file}  →  ${[...new Set(hits)].join(', ')}`);
    }
  }
  return { offenders, usedExceptions };
}

describe('content-script storage boundary (#32)', () => {
  it('no content-script module value-imports shared/db or shared/telemetry', () => {
    const { offenders } = scan();
    expect(
      offenders,
      'Content-script modules must message the service worker instead:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('every exception in the allowlist is still needed', () => {
    const { usedExceptions } = scan();
    const stale = [...ALLOWED.keys()].filter((file) => !usedExceptions.has(file));
    expect(
      stale,
      'These files no longer import a restricted module — delete their allowlist entry: ' +
        stale.join(', '),
    ).toEqual([]);
  });
});
