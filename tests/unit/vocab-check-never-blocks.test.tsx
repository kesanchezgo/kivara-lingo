/**
 * F5 gate: the check never blocks saving (docs/REDESIGN-V2.md §7 F5, §8).
 *
 * A run of invented words marked and every meaning question failed lowers the
 * weight of the result and the result screen SAYS so — but the save button
 * exists and is enabled, and the answers reach the profile. The old prototype
 * blocked the save, which was worse.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { VocabCheck } from '../../src/content/ui/VocabCheck';
import { COMMITTED_BANK } from '../../src/shared/study/vocabCheck';
import { buildEstimator, type StudyWords } from '../../src/shared/study/wordStatus';

const words: StudyWords = { features: (key) => ({ key }) };
const estimate = buildEstimator({
  marks: {},
  profile: { selfLevel: null, vocabTest: null },
  anki: {},
  l1: 'en',
  words,
  now: 1_700_000_000_000,
});

describe('VocabCheck', () => {
  it('keeps the save enabled after marking everything (pseudowords included)', () => {
    const onSave = vi.fn();
    const { container } = render(
      <VocabCheck
        bank={COMMITTED_BANK}
        l1="en"
        langName="inglés"
        before={estimate}
        preview={() => estimate}
        onSave={onSave}
        seed={99}
      />,
    );

    const tiles = container.querySelectorAll<HTMLButtonElement>('[data-vocab-grid] button');
    expect(tiles).toHaveLength(45);
    tiles.forEach((tile) => fireEvent.click(tile));

    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-vocab-next]')!);

    // All five invented words were marked: the result is low quality and says so.
    expect(container.querySelector('[role="status"]')).toBeTruthy();

    const apply = container.querySelector<HTMLButtonElement>('[data-vocab-apply]');
    expect(apply).toBeTruthy();
    expect(apply!.disabled).toBe(false);

    fireEvent.click(apply!);
    expect(onSave).toHaveBeenCalledTimes(1);
    const [answers, checks, shown] = onSave.mock.calls[0] as [string[], Record<string, string>, string[]];
    expect(answers).toHaveLength(45);
    expect(shown).toHaveLength(45);
    expect(checks).toEqual({});
  });

  it('a clean pass has no warning and still saves', () => {
    const onSave = vi.fn();
    const { container } = render(
      <VocabCheck
        bank={COMMITTED_BANK}
        l1="en"
        langName="inglés"
        before={estimate}
        preview={() => estimate}
        onSave={onSave}
        seed={99}
      />,
    );

    // Mark only the real words that appear (never an invented one).
    const shown = [...container.querySelectorAll<HTMLButtonElement>('[data-vocab-grid] button')]
      .map((tile) => tile.textContent ?? '');
    const fakes = new Set(COMMITTED_BANK.fakes);
    for (const tile of container.querySelectorAll<HTMLButtonElement>('[data-vocab-grid] button')) {
      if (!fakes.has(tile.textContent ?? '') && shown.length) fireEvent.click(tile);
    }
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-vocab-next]')!);

    expect(container.querySelector('[role="status"]')).toBeNull();
    const apply = container.querySelector<HTMLButtonElement>('[data-vocab-apply]');
    expect(apply!.disabled).toBe(false);
    fireEvent.click(apply!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});