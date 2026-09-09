import { describe, expect, it } from 'vitest';
import {
  extractLongmanCollocations,
  extractLongmanQuality,
  extractLongmanSenseCollocationGroups,
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

// COLLO spans nested inside dictionary Sense blocks, like Longman ships
// them live: each collocation belongs to the sense whose DEF precedes it
// (verified 2026-09-06 on `give`: give__3 → control/authority, give__4 →
// orders/instructions).
const SENSE_COLLOCATION_FIXTURE = `
  <span class="Sense" id="give__3">
    <span class="DEF">to allow or make it possible for someone to do something</span>
    <span class="COLLO">give somebody control/authority/responsibility etc</span>
  </span>
  <span class="Sense" id="give__4">
    <span class="DEF">to tell someone information or details about something</span>
    <span class="COLLO">give orders/instructions</span>
    <span class="COLLO">give an account/description</span>
  </span>
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

  it('scopes each COLLO span to its own Sense block with the DEF as anchor', () => {
    const groups = extractLongmanSenseCollocationGroups(SENSE_COLLOCATION_FIXTURE);

    expect(groups).toHaveLength(2);
    // Slash shorthand expands inside the sense scope.
    expect(groups[0]).toMatchObject({
      guide: 'to allow or make it possible for someone to do something',
      collocations: ['give somebody control', 'give somebody authority', 'give somebody responsibility'],
    });
    expect(groups[1]).toMatchObject({
      guide: 'to tell someone information or details about something',
      collocations: ['give orders', 'give instructions', 'give an account', 'give a description'],
    });
  });

  it('carries the sense groups into the quality payload beside the flat list', () => {
    const result = extractLongmanQuality(SENSE_COLLOCATION_FIXTURE, 'give');

    expect(result.collocations).toContain('give orders');
    const scoped = (result.relationGroups ?? []).filter((group) => group.collocations?.length);
    expect(scoped).toHaveLength(2);
    expect(scoped[0].definition).toContain('make it possible');
  });
});
