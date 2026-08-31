import { describe, expect, it } from 'vitest';
import {
  extractLongmanCollocations,
  extractLongmanQuality,
} from '../../src/background/enrichment/sources/longman';

const QUALITY_FIXTURE = `
  <span class="FREQ">S1 W1</span>
  <span class="FREQ">S1</span>
  <span class="DEF">having a larger size than usual</span>
  <span class="DEF">having a larger size than usual</span>
  <span class="EXAMPLE">They live in a big house.</span>
  <span class="ThesBox">
    <span class="Exponent">
      <span class="EXP">big</span>
      <span class="DEF">greater than average in size</span>
      <span class="EXAMPLE">They bought a big house.</span>
    </span>
    <span class="Exponent">
      <span class="EXP">large</span>
      <span class="DEF">greater than average in size</span>
      <span class="EXAMPLE">A large crowd gathered outside.</span>
    </span>
  </span>
  <span class="ThesBox">
    <span class="Exponent">
      <span class="EXP">important</span>
      <span class="DEF">having a serious effect</span>
      <span class="EXAMPLE">This is a very important decision.</span>
    </span>
  </span>
  <span class="COLLO">unscoped legacy value</span>
  <span class="COLLOC">outside the box</span>
  <span class="ColloBox">
    <span class="COLLOC">a big decision</span>
    <span class="COLLOC">a big decision</span>
    <span class="COLLOC">big business</span>
  </span>
`;

const LEGACY_COLLOCATION_FIXTURE = `
  <span class="COLLO">make a decision</span>
  <span class="COLLO">make a decision</span>
  <span class="COLLO">reach a decision</span>
`;

describe('Longman quality extraction', () => {
  it('preserves S1/W1 as typed LDOCE frequency evidence', () => {
    const result = extractLongmanQuality(QUALITY_FIXTURE);

    expect(result.frequencyEvidence).toEqual([
      { scale: 'longman-spoken', value: 'S1', corpus: 'LDOCE' },
      { scale: 'longman-written', value: 'W1', corpus: 'LDOCE' },
    ]);
    expect(result).not.toHaveProperty('frequencyRank');
  });

  it('keeps each thesaurus exponent in its own sense group', () => {
    const result = extractLongmanQuality(QUALITY_FIXTURE, 'big');

    expect(result.relationGroups).toEqual([
      {
        guide: 'greater than average in size',
        example: 'They bought a big house.',
        synonyms: ['large'],
      },
      {
        guide: 'having a serious effect',
        example: 'This is a very important decision.',
        synonyms: ['important'],
      },
    ]);
    expect(result.definitions).toEqual(['having a larger size than usual']);
    expect(result.examples).toEqual([{ text: 'They live in a big house.' }]);
  });

  it('uses only COLLOC values scoped to ColloBox when one exists', () => {
    expect(extractLongmanCollocations(QUALITY_FIXTURE)).toEqual([
      'a big decision',
      'big business',
    ]);
  });

  it('retains the legacy COLLO fallback without a ColloBox', () => {
    expect(extractLongmanCollocations(LEGACY_COLLOCATION_FIXTURE)).toEqual([
      'make a decision',
      'reach a decision',
    ]);
  });
});
