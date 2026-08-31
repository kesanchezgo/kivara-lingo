import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lookupDictionary } from '../../src/content/nlp/dictionary';
import { WordPopover } from '../../src/content/ui/WordPopover';

describe('WordPopover canonical lookup', () => {
  it('shows an inflected MWE surface form while resolving its canonical dictionary key', async () => {
    const canonical = lookupDictionary('look up');
    expect(canonical?.translation).toBeTruthy();

    render(
      <WordPopover
        visible
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
        token="looking up"
        lookupToken="look up"
        sentence="She was looking up the word."
        sourceLang="en"
        includeAi={false}
        kind="mwe"
        mweKind="phrasal"
        lemma="look up"
        isExpanded={false}
        isSaved={false}
        parentMWE={null}
        onToggleExpand={() => {}}
        onRejoinParent={() => {}}
        onSave={() => {}}
      />,
    );

    expect((await screen.findAllByText('looking up')).length).toBeGreaterThan(0);
    expect(await screen.findByText(canonical!.translation)).toBeTruthy();
  });
});
