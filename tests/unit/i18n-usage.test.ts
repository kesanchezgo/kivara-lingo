/**
 * Every key the codebase asks `t()` for must exist in BOTH dictionaries.
 *
 * A typo (`t('cards.ankiSaveError')` when the key is `app.ankiSaveError`) and
 * a translation that forgot one of the two locales are invisible at runtime:
 * the fallback prints the RAW KEY to the user. This test catches that on every
 * `t('...')` call in src/.
 *
 * Since F0 the dictionaries are split by area (src/shared/i18n/*) so the
 * service worker can import only what it emits. The parity assertions below
 * run against the merged barrel — which is what the UI sees — and two extra
 * checks cover the worker subsets: every key a background module calls
 * resolves in `shared/i18n/sw`, and every key a shared (worker-imported)
 * module calls resolves in `shared/i18n/core`.
 *
 * Previously the dictionaries were read out of the file with a regex; that
 * made splitting the file a silent test failure. Importing them is what the
 * split needs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ALL_MESSAGES } from '../../src/shared/i18n';
import { sw } from '../../src/shared/i18n/sw';
import { core } from '../../src/shared/i18n/core';

const root = process.cwd();

const walk = (dir: string, acc: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) acc.push(full);
  }
  return acc;
};

/** Key literals the codebase passes to `t()`. */
function keysUsedIn(dir: string, skip?: (file: string) => boolean): Set<string> {
  const keys = new Set<string>();
  for (const f of walk(path.join(root, dir))) {
    if (skip?.(f.replace(/\\/g, '/'))) continue;
    const text = readFileSync(f, 'utf8');
    // t('one.key') and t(`one.key`), the two literal shapes.
    for (const m of text.matchAll(/\bt\(\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g)) {
      keys.add(m[1]);
    }
  }
  return keys;
}

describe('t() calls resolve in both dictionaries', () => {
  it('no key used in code is missing from either map', () => {
    const used = keysUsedIn('src');
    const missingEs = [...used].filter((k) => !(k in ALL_MESSAGES.es));
    const missingEn = [...used].filter((k) => !(k in ALL_MESSAGES.en));
    expect(missingEs, `called but not in the ES map: ${missingEs.join(', ')}`).toEqual([]);
    expect(missingEn, `called but not in the EN map: ${missingEn.join(', ')}`).toEqual([]);
  });

  it('both maps ship the same key set', () => {
    const es = new Set(Object.keys(ALL_MESSAGES.es));
    const en = new Set(Object.keys(ALL_MESSAGES.en));
    const onlyEs = [...es].filter((k) => !en.has(k));
    const onlyEn = [...en].filter((k) => !es.has(k));
    expect(onlyEs, 'es-only keys').toEqual([]);
    expect(onlyEn, 'en-only keys').toEqual([]);
  });

  it('every key a background module calls resolves in the worker subset', () => {
    const used = keysUsedIn('src/background');
    const missingEs = [...used].filter((k) => !(k in sw.es));
    const missingEn = [...used].filter((k) => !(k in sw.en));
    expect(missingEs, `background but not in sw.es: ${missingEs.join(', ')}`).toEqual([]);
    expect(missingEn, `background but not in sw.en: ${missingEn.join(', ')}`).toEqual([]);
  });

  it('every key a shared module calls resolves in the worker core subset', () => {
    const used = keysUsedIn('src/shared', (f) => f.includes('/shared/i18n'));
    const missingEs = [...used].filter((k) => !(k in core.es));
    const missingEn = [...used].filter((k) => !(k in core.en));
    expect(missingEs, `shared but not in core.es: ${missingEs.join(', ')}`).toEqual([]);
    expect(missingEn, `shared but not in core.en: ${missingEn.join(', ')}`).toEqual([]);
  });
});
