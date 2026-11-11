import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EpisodeGroup } from '../../src/app/components/tabs/EpisodeGroup';
import { episodeCoverage } from '../../src/app/components/tabs/episodeCoverage';
import { t } from '../../src/shared/i18n';
import type { WordStatus } from '../../src/shared/study/wordStatus';

const statusMap: Record<string, WordStatus> = { k: 'known', l: 'learning', n: 'new' };
const statusOf = (key: string): WordStatus => statusMap[key];

const coverageOf = (known: number, learning: number, fresh: number) =>
  episodeCoverage(
    [{ key: 'k', count: known }, { key: 'l', count: learning }, { key: 'n', count: fresh }],
    statusOf,
  );

describe('EpisodeGroup coverage', () => {
  it('renders the known share, the bar and the two marks for a known episode', () => {
    const coverage = coverageOf(90, 5, 5);
    const { container } = render(
      <EpisodeGroup
        episodeLangName="inglés"
        activeLangName="inglés"
        sameProfile
        coverage={coverage}
      />,
    );

    expect(screen.getByText('90%')).toBeTruthy();
    const bar = screen.getByRole('img');
    expect(bar.getAttribute('aria-label')).toBe(t('ws.coverageAria', { known: 90, learning: 5, fresh: 5 }));

    // One segment per status, plus the 80% and 95% markers.
    expect(container.querySelector('[data-coverage-segment="known"]')).toBeTruthy();
    expect(container.querySelector('[data-coverage-segment="learning"]')).toBeTruthy();
    expect(container.querySelector('[data-coverage-segment="new"]')).toBeTruthy();
    const marks = [...container.querySelectorAll('[data-coverage-mark]')].map((el) => el.getAttribute('data-coverage-mark'));
    expect(marks).toEqual(['80', '95']);
  });

  it('shows the easy verdict at 95% and the hard verdict below 80%', () => {
    const { container, unmount } = render(
      <EpisodeGroup episodeLangName="english" activeLangName="english" sameProfile coverage={coverageOf(95, 3, 2)} />,
    );
    expect(container.querySelector('[data-coverage-verdict]')?.textContent).toBe(t('ws.coverageEasy'));
    unmount();

    const hard = render(
      <EpisodeGroup episodeLangName="english" activeLangName="english" sameProfile coverage={coverageOf(50, 25, 25)} />,
    );
    expect(hard.container.querySelector('[data-coverage-verdict]')?.textContent).toBe(t('ws.coverageHard'));
  });

  it('opens the episode words from the link', () => {
    const onOpenWords = vi.fn();
    render(
      <EpisodeGroup episodeLangName="english" activeLangName="english" sameProfile coverage={coverageOf(90, 5, 5)} onOpenWords={onOpenWords} />,
    );
    const link = screen.getByText(t('ws.ep.toggle')).closest('button');
    expect(link).toBeTruthy();
    fireEvent.click(link!);
    expect(onOpenWords).toHaveBeenCalledTimes(1);
  });

  it('shows the other-language notice instead of a percentage when the profiles differ', () => {
    const { container } = render(
      <EpisodeGroup episodeLangName="inglés" activeLangName="francés" sameProfile={false} coverage={null} />,
    );
    expect(screen.getByText(t('ws.otherLangTitle', { episode: 'inglés' }))).toBeTruthy();
    expect(
      screen.getByText(t('ws.otherLangBody', { episode: 'inglés', lang: 'francés' })),
    ).toBeTruthy();
    expect(container.querySelector('[data-episode-coverage]')).toBeNull();
    // The link to the episode word list is still offered.
    expect(container.querySelector('[data-open-episode-words]')).toBeTruthy();
  });
});