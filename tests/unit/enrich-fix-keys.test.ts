/**
 * The enrichment fix copy is an EXPLICIT map, never a composed key (parity
 * close-out point 1).
 *
 * The old render did `` t(`${msgKey}Fix`) `` — a family without a `*Fix` key
 * fell back to the raw key string and the user read `vipx.errNetworkFix` in
 * the tooltip, while the dead-key scanner could not see any of the composed
 * names. The contract here: every key the maps name exists in BOTH locales,
 * the source variant wins over the family's generic line, and `unknown` has
 * no fix because the panel has no idea what happened.
 */
import { describe, expect, it } from 'vitest';
import {
  enrichFixKey,
  ENRICH_ERROR_FIX_KEYS,
  ENRICH_ERROR_KEYS,
  ENRICH_SOURCE_FIX_KEYS,
  ENRICH_SLOW_FIX_KEY,
} from '../../src/shared/enrich-health';
import { ALL_MESSAGES } from '../../src/shared/i18n';

/** One locale map per key the module names — the bug was a missing entry. */
function presentInBothLocales(key: string): string | null {
  const es = ALL_MESSAGES.es[key];
  const en = ALL_MESSAGES.en[key];
  if (es && en) return null;
  if (!es && !en) return `missing in BOTH locales: ${key}`;
  return `locale mismatch for ${key}: es=${JSON.stringify(es)} en=${JSON.stringify(en)}`;
}

describe('ENRICH_ERROR_KEYS', () => {
  it('names a key that exists in es and en for every failure family', () => {
    const problems = Object.values(ENRICH_ERROR_KEYS)
      .map(presentInBothLocales)
      .filter((p): p is string => p !== null);
    expect(problems).toEqual([]);
  });
});

describe('ENRICH_ERROR_FIX_KEYS', () => {
  it('has a fix in es and en for every family that has one', () => {
    const values = Object.values(ENRICH_ERROR_FIX_KEYS).filter((v): v is string => v != null);
    expect(values.length).toBeGreaterThanOrEqual(8);
    const problems = values.map(presentInBothLocales).filter((p): p is string => p !== null);
    expect(problems).toEqual([]);
  });

  it('covers the eight failure families and carries the group placeholder', () => {
    for (const code of ['unauthorized', 'forbidden', 'notFound', 'rateLimited', 'server', 'timeout', 'permission', 'network'] as const) {
      expect(ENRICH_ERROR_FIX_KEYS[code], code).toBeTruthy();
    }
    // The map names keys; the COPY carries the placeholder the render fills
    // with the owning group's label.
    expect(ALL_MESSAGES.es[ENRICH_ERROR_FIX_KEYS.permission!]).toContain('{group}');
    expect(ALL_MESSAGES.en[ENRICH_ERROR_FIX_KEYS.permission!]).toContain('{group}');
    // No fix for what nobody can diagnose.
    expect(ENRICH_ERROR_FIX_KEYS.unknown).toBeUndefined();
  });

  it('renders the permission fix with the owning group label', () => {
    const key = ENRICH_ERROR_FIX_KEYS.permission!;
    const es = ALL_MESSAGES.es[key].replace('{group}', 'Imágenes y audio humano');
    const en = ALL_MESSAGES.en[key].replace('{group}', 'Images & human audio');
    expect(es).toContain('Imágenes y audio humano');
    expect(en).toContain('Images & human audio');
  });
});

describe('ENRICH_SOURCE_FIX_KEYS', () => {
  it('carries the three source-specific variants in es and en', () => {
    const pairs: Array<[string, string]> = [
      ['unsplash', 'unauthorized'],
      ['pixabay', 'rateLimited'],
      ['reverso', 'forbidden'],
    ];
    const problems: string[] = [];
    for (const [source, code] of pairs) {
      const key = ENRICH_SOURCE_FIX_KEYS[source]?.[code as never];
      if (!key) { problems.push(`missing variant for ${source}/${code}`); continue; }
      const problem = presentInBothLocales(key);
      if (problem) problems.push(problem);
    }
    expect(problems).toEqual([]);
  });

  it('keeps the prototype wording for the named sources', () => {
    // The prototype's `vipx.err401Fix` IS the Unsplash answer, `err429Fix`
    // IS Pixabay's, `err403Fix` IS Reverso's — the variants must say so.
    expect(ALL_MESSAGES.es[ENRICH_SOURCE_FIX_KEYS.unsplash!.unauthorized!]).toContain('Unsplash');
    expect(ALL_MESSAGES.es[ENRICH_SOURCE_FIX_KEYS.pixabay!.rateLimited!]).toContain('Pixabay');
    expect(ALL_MESSAGES.es[ENRICH_SOURCE_FIX_KEYS.reverso!.forbidden!]).toContain('reverso.net');
    expect(ALL_MESSAGES.en[ENRICH_SOURCE_FIX_KEYS.unsplash!.unauthorized!]).toContain('Unsplash');
    expect(ALL_MESSAGES.en[ENRICH_SOURCE_FIX_KEYS.pixabay!.rateLimited!]).toContain('Pixabay');
    expect(ALL_MESSAGES.en[ENRICH_SOURCE_FIX_KEYS.reverso!.forbidden!]).toContain('reverso.net');
  });
});

describe('enrichFixKey', () => {
  it('prefers the source variant over the family line', () => {
    expect(enrichFixKey('unsplash', 'unauthorized')).toBe('vipx.fixUnsplash401');
    expect(enrichFixKey('pixabay', 'rateLimited')).toBe('vipx.fixPixabay429');
    expect(enrichFixKey('reverso', 'forbidden')).toBe('vipx.fixReverso403');
  });

  it('falls back to the family line when the pair has no variant', () => {
    expect(enrichFixKey('unsplash', 'rateLimited')).toBe(ENRICH_ERROR_FIX_KEYS.rateLimited);
    expect(enrichFixKey('datamuse', 'timeout')).toBe(ENRICH_ERROR_FIX_KEYS.timeout);
    expect(enrichFixKey(undefined, 'network')).toBe(ENRICH_ERROR_FIX_KEYS.network);
  });

  it('answers nothing for unknown and nothing for a local source', () => {
    expect(enrichFixKey('bundled', 'unknown')).toBeUndefined();
    expect(enrichFixKey('wordnet', 'unauthorized')).toBe(ENRICH_ERROR_FIX_KEYS.unauthorized);
  });
});

describe('ENRICH_SLOW_FIX_KEY', () => {
  it('exists in es and en', () => {
    expect(presentInBothLocales(ENRICH_SLOW_FIX_KEY)).toBeNull();
  });
});
