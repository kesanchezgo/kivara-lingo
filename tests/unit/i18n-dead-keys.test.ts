/**
 * No dead i18n keys: every key shipped in the dictionaries must be reachable.
 *
 * `i18n-usage.test.ts` answers the opposite question (a key the code calls is
 * missing). This one answers the debt question F9 closes: a key that survived
 * its view — `app.demo*`, the prototype's `onb.step.*` ids, the old `freq.*`
 * band labels — still ships two strings, still inflates every dictionary and
 * still gets indexed by the Preferences search. It is invisible at runtime,
 * which is exactly why it needs a test.
 *
 * Liveness is conservative on purpose:
 *   - a literal passed to `t()` (`t('a.b')`, `t(`a.b`)`);
 *   - a key used indirectly, i.e. the exact string appears as a quoted literal
 *     somewhere in `src/` or `tests/` (`rail.viewLines` lives in a lookup
 *     table, not in a `t()` call);
 *   - an explicit dynamic prefix from ALLOWED_PREFIXES (template keys such as
 *     `lang.${code}`, the `keysWithPrefix()` families the search indexes, the
 *     day-plural family `fmtDays()` resolves).
 *
 * The scan skips `src/shared/i18n/**` itself: the dictionary files hold every
 * key as a literal, so counting them would make the test pass vacuously.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ALL_MESSAGES } from '../../src/shared/i18n';

/**
 * Dynamic families, each with the call site that resolves it.
 *
 * Template keys: `t(`lang.${code}`)`, `t(`tr.${mode}`)`, `t(`ws.level.${level}`)`,
 * `t(`recent.kind.${kind}`)`.
 * `keysWithPrefix()` families: src/app/components/tabs/settingsSearch.ts feeds
 * the Preferences search the prefixes below; a new control in one of those
 * sections is live even before it gets its own `t()` call.
 * `common.days*`: fmtDays() picks between `common.daysOne` and `common.daysN`.
 */
const ALLOWED_PREFIXES = [
  // Template-key families.
  'lang.',
  'tr.',
  'ws.level.',
  'ws.levelCanDo.',
  'recent.kind.',
  // fmtDays().
  'common.days',
  // settingsSearch.ts → keysWithPrefix().
  'dict.',
  'dictpack.',
  'vip.',
  'vipx.',
  'ai.',
  'aicompat.',
  'perm.',
  'sc.',
  'subs.',
  'sub.',
  'ws.vocab',
  'ws.self',
  'ws.coverage',
  'ws.ep.',
  'vc.',
  'vt.',
  'cards.',
  'recent.',
  'queue.',
] as const;

const ROOT = process.cwd();
const SCANNED_DIRS = ['src', 'tests'];
const SKIP_SEGMENT = `${path.sep}shared${path.sep}i18n${path.sep}`;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) acc.push(full);
  }
  return acc;
}

/** Everything the codebase references, as key-shaped strings. */
export function referencedKeys(): Set<string> {
  const refs = new Set<string>();
  for (const dir of SCANNED_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      if (file.includes(SKIP_SEGMENT)) continue;
      // This file fabricates dead keys on purpose; counting them as refs would
      // make the self-check pass for the wrong reason.
      if (file.endsWith('i18n-dead-keys.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      // t('a.b') / t("a.b") / t(`a.b`) — the literal call shapes.
      for (const m of text.matchAll(/\bt\(\s*['"`]([a-zA-Z0-9_.-]+)['"`]/g)) refs.add(m[1]);
      // A key held in a lookup table and passed to t(variable) later.
      for (const m of text.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+)['"`]/g)) refs.add(m[1]);
    }
  }
  return refs;
}

export function deadKeys(keys: string[], refs: Set<string>, prefixes: readonly string[] = ALLOWED_PREFIXES): string[] {
  return keys.filter(
    (key) => !refs.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
  );
}

const REFS = referencedKeys();
const DICTIONARY_KEYS = Object.keys(ALL_MESSAGES.es);

describe('no dead i18n keys', () => {
  it('every key in the ES dictionary is referenced', () => {
    const dead = deadKeys(DICTIONARY_KEYS, REFS);
    expect(
      dead,
      dead.length
        ? `Dead i18n keys (no t() call, no indirect reference, no dynamic prefix): ${dead.join(', ')}`
        : 'no dead keys',
    ).toEqual([]);
  });

  it('the parity map carries no ES-only survivor', () => {
    // The en map must lose the same keys: a key removed from one side only
    // would otherwise keep the parity test green while shipping a lone string.
    const enOnly = Object.keys(ALL_MESSAGES.en).filter((k) => !(k in ALL_MESSAGES.es));
    expect(enOnly, 'en-only keys').toEqual([]);
  });

  it('the detector actually distinguishes live from dead keys', () => {
    // Guards against a vacuous pass: the scanner must find a known live key
    // and must call a fabricated one dead.
    expect(deadKeys(['panel.tabSettings'], REFS)).toEqual([]);
    expect(deadKeys(['no.such.key'], REFS)).toEqual(['no.such.key']);
    expect(deadKeys(['lang.zz'], REFS)).toEqual([]); // allowlisted family
  });
});
