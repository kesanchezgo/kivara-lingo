/**
 * Point 7 — raw identifiers leaking into dictionary entries.
 *
 * The QA card showed definitions like «greece_prefectures. kgm» and
 * «VeoVeo—veo»: a source returned a machine key with underscores plus a
 * trailing abbreviation, and the merge step published it verbatim, under the
 * lemma echo the card already prints. A learner reads that as garbage.
 *
 * These strings are the ones the QA captured; the rules are conservative —
 * anything that could be a real definition survives untouched.
 */
import { describe, expect, it } from 'vitest';
import { normalizeDefinition } from '../../src/background/enrichment/normalize-definition';

describe('normalizeDefinition', () => {
  it('turns underscores into spaces', () => {
    expect(normalizeDefinition('greece_prefectures. kgm', 'Larisa')).toBe('greece prefectures');
  });

  it('drops the lemma echo the card already prints', () => {
    expect(normalizeDefinition('veo — veo', 'veo')).toBe('');
    expect(normalizeDefinition('veo - veo', 'veo')).toBe('');
    expect(normalizeDefinition('Larisa: Larisa', 'Larisa')).toBe('');
  });

  it('drops blank placeholders and what is left of them', () => {
    expect(normalizeDefinition('_____ está via', 'está')).toBe('');
    expect(normalizeDefinition('___', 'word')).toBe('');
  });

  it('drops a trailing abbreviation fragment', () => {
    expect(normalizeDefinition('greece prefectures. kgm', 'Larisa')).toBe('greece prefectures');
    expect(normalizeDefinition('a unit of length. m', 'metro')).toBe('a unit of length');
  });

  it('keeps a real definition, punctuation and parentheses included', () => {
    const real = 'the syllable naming the seventh (subtonic) note of any musical scale';
    expect(normalizeDefinition(real, 'te')).toBe(real);
    expect(normalizeDefinition('  a  place   where  planes  land.  ', 'airport'))
      .toBe('a place where planes land.');
  });

  it('returns empty for empty or punctuation-only input', () => {
    expect(normalizeDefinition('', 'x')).toBe('');
    expect(normalizeDefinition('   ', 'x')).toBe('');
    expect(normalizeDefinition('—', 'x')).toBe('');
  });
});

describe('the merge step publishes the cleaned text', () => {
  it('drops a machine key and a lemma echo before the card sees them', async () => {
    const { mergeFields } = await import('../../src/background/enrichment/merge');
    const source = (id: string) => ({ id, label: id, enrich: async () => ({}) });
    const merged = mergeFields(
      'Larisa',
      [{ source: source('wiktionaryHtml') as never, partial: { definitions: ['greece_prefectures. kgm'] } as never }],
      { sourceLang: 'es', targetLang: 'en', timeoutMs: 1 } as never,
    );
    const published = JSON.stringify(merged.vip.definitions ?? []) + JSON.stringify(merged.entry ?? {});
    expect(published).not.toContain('_');
    expect(published).not.toMatch(/kgm/);
  });
});
