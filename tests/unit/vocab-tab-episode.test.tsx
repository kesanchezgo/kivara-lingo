import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VocabTab } from '../../src/app/components/tabs/VocabTab';

describe('Vocabulary tab episode group', () => {
  it('hides the episode group when the host has no episode (Options)', () => {
    const { container } = render(<VocabTab />);
    expect(container.querySelector('[data-episode-group]')).toBeNull();
    expect(container.querySelector('[data-open-episode-words]')).toBeNull();
  });

  it('shows the episode group and its link when a track is present', () => {
    const { container } = render(
      <VocabTab episode={{ cues: [{ text: 'The cat sat on the mat', start: 0 }], lang: 'en' }} />,
    );
    expect(container.querySelector('[data-episode-group]')).toBeTruthy();
    expect(container.querySelector('[data-open-episode-words]')).toBeTruthy();
  });
});