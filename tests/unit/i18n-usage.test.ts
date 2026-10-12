/**
 * Every key the codebase asks `t()` for must exist in BOTH dictionaries.
 *
 * A typo (`t('cards.ankiSaveError')` when the key is `app.ankiSaveError`)
 * and a translation that forgot one of the two locales are invisible at
 * runtime: the fallback prints the RAW KEY to the user. That is what this
 * test catches, on every `t('...')` call in src/.
 *
 * Mirrors the same parity the i18n dictionary test enforces BETWEEN the
 * dictionaries (every key in `es` must be in `en`, and vice versa); this
 * one adds the other half — the keys the code actually USES.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

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
function keysUsedInCode(): string[] {
  const files = walk(path.join(root, 'src'));
  const keys = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    // t('one.key') and t(`one.key`), the two literal shapes.
    for (const m of text.matchAll(/\bt\(\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g)) {
      keys.add(m[1]);
    }
  }
  return [...keys];
}

function dictionaries(): { es: Set<string>; en: Set<string> } {
  const text = readFileSync(path.join(root, 'src/shared/i18n.ts'), 'utf8');
  const grab = (mapName: 'es' | 'en'): Set<string> => {
    // Matches `const es: Dict = { ... };` and captures every key literal.
    const src = text.split(new RegExp(`const ${mapName}:`))[1] ?? '';
    const block = src.slice(0, src.indexOf('\n};'));
    const keys = new Set<string>();
    for (const m of block.matchAll(/^\s*'([^']+)':/gm)) keys.add(m[1]);
    return keys;
  };
  return { es: grab('es'), en: grab('en') };
}

describe('t() calls resolve in both dictionaries', () => {
  it('no key used in code is missing from either map', () => {
    const used = keysUsedInCode();
    const { es, en } = dictionaries();
    const missingEs = used.filter((k) => !es.has(k));
    const missingEn = used.filter((k) => !en.has(k));
    expect(
      missingEs,
      `called but not in the ES map: ${missingEs.join(', ')}`,
    ).toEqual([]);
    expect(
      missingEn,
      `called but not in the EN map: ${missingEn.join(', ')}`,
    ).toEqual([]);
  });

  it('both maps ship the same key set', () => {
    const { es, en } = dictionaries();
    const onlyEs = [...es].filter((k) => !en.has(k));
    const onlyEn = [...en].filter((k) => !es.has(k));
    expect(onlyEs, 'es-only keys').toEqual([]);
    expect(onlyEn, 'en-only keys').toEqual([]);
  });
});
