import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FrequencyBadge } from '../../src/content/ui/FrequencyBadge';
import { fmtNumber, t } from '../../src/shared/i18n';

describe('FrequencyBadge', () => {
  it('renders the band and the rank title for a known rank', () => {
    render(<FrequencyBadge rank={500} />);
    const chip = screen.getByText(t('freq.veryFrequent'));
    expect(chip.getAttribute('title')).toBe(t('freq.rankTitle', { rank: fmtNumber(500) }));
    expect(chip.getAttribute('data-rank')).toBe('500');
  });

  it('renders the uncommon band for a rank past the last window', () => {
    render(<FrequencyBadge rank={8342} />);
    expect(screen.getByText(t('freq.uncommon'))).toBeTruthy();
  });

  it('falls back to the enriched band when the list has no rank', () => {
    render(
      <FrequencyBadge
        rank={null}
        fallback={{ scale: 'longman-spoken', value: 'S1' }}
        fallbackTitle="Longman · spoken"
      />,
    );
    const chip = screen.getByText(t('freq.topSpoken1000'));
    expect(chip.getAttribute('title')).toBe('Longman · spoken');
  });

  it('renders nothing when there is neither rank nor fallback', () => {
    const { container } = render(<FrequencyBadge rank={null} />);
    expect(container.textContent).toBe('');
  });
});