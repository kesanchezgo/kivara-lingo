/**
 * RED TEST — Netflix must use the Kivara-owned player bar from the mock,
 * not a tiny group appended inside Netflix's own control row.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/content/ui/App';
import { railOpenStore } from '../../src/content/ui/ui-state';
import { useKivaraStore } from '../../src/shared/use-kivara-store';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  for (const style of Array.from(document.querySelectorAll('style[id^="kivara-owned-bar-"], style[id^="kivara-cleanup-"]'))) style.remove();
});

const netflix = {
  platform: 'netflix',
  hideNativeSubtitles: () => {},
  showNativeSubtitles: () => {},
  onCueChange: () => () => {},
  playback: null,
} as unknown as Parameters<typeof App>[0]['adapter'];

describe('owned Netflix player bar', () => {
  it('mounts the mock-fidelity bar in the video overlay and hides Netflix bottom chrome', async () => {
    await useKivaraStore.persist.rehydrate();
    useKivaraStore.setState({ enabled: true, panelOpen: false, isPopupMode: false });
    railOpenStore.set(false);
    // A real Netflix row in the page: without the owned-bar gate the old
    // inline slot would mount here and the test must catch it.
    const player = document.createElement('div');
    player.className = 'watch-video';
    const row = document.createElement('div');
    row.className = 'PlayerControlsNeo__bottom-controls';
    row.innerHTML = '<button data-uia="control-play"></button><button data-uia="control-audio-subtitle"></button>';
    player.append(row);
    document.body.append(player);

    const overlay = document.createElement('div');
    document.body.append(overlay);
    render(
      <App
        adapter={netflix}
        videoElement={document.createElement('video')}
        videoOverlayRoot={overlay}
      />,
    );

    const bar = document.querySelector<HTMLElement>('[data-kvl-player-bar]');
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain('bg-gradient-to-t');
    expect(bar!.querySelector('.bg-zinc-900\\/70')).not.toBeNull();
    expect(bar!.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(document.getElementById('kivara-lingo-bar-slot')).toBeNull();

    const hidden = document.getElementById('kivara-owned-bar-netflix');
    expect(hidden).not.toBeNull();
    expect(hidden!.textContent).toContain('visibility: hidden');
  });
});
