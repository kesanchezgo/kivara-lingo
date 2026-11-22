/**
 * Panel → transcript hand-off (#38).
 *
 * With the rail docked beside the panel, the panel header offers "Ir a la
 * transcripción": the same columns, one keyboard jump away.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidePanel } from '../../src/content/ui/SidePanel';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import { buildPreviewData } from '../../src/shared/preview-data';

function renderPanel(onShowTranscript?: () => void) {
  const state = useKivaraStore.getState();
  return render(
    <SidePanel
      isPopupMode={false}
      onClose={vi.fn()}
      isDarkMode
      toggleDarkMode={vi.fn()}
      styles={state.subtitleStyles}
      setStyles={vi.fn()}
      mapping={state.ankiMapping}
      setMapping={vi.fn()}
      mockData={buildPreviewData('Hello there.')}
      onShowTranscript={onShowTranscript}
    />,
  );
}

describe('SidePanel transcript hand-off', () => {
  it('offers the transcript action and calls it', () => {
    const onShowTranscript = vi.fn();
    renderPanel(onShowTranscript);
    fireEvent.click(screen.getByTitle(/Ir a la transcripción/));
    expect(onShowTranscript).toHaveBeenCalledTimes(1);
  });

  it('hides the action when there is no rail to jump to', () => {
    renderPanel(undefined);
    expect(screen.queryByTitle(/Ir a la transcripción/)).toBeNull();
  });
});
