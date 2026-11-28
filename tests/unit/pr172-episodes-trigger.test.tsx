/**
 * PR #172 — the episodes trigger waits for the graph instead of giving up.
 *
 * Netflix hydrates `falcorCache` after the tray mounts, so the first read can
 * legitimately come back empty. Pressing Episodios in that state used to hand
 * the user straight to Netflix's own drawer; it now re-reads the catalog once,
 * on the click, and only then falls back. The native fallback is the last
 * resort, not the first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlayerBar } from '../../src/content/ui/PlayerBar';
import { t } from '../../src/shared/i18n';
import { nativePopupOpen } from '../../src/content/ui/cleanup-css';

const listEpisodesThroughMainWorld = vi.fn();

vi.mock('../../src/content/platform-adapters/netflix-main-bridge', () => ({
  listEpisodesThroughMainWorld: () => listEpisodesThroughMainWorld(),
  listAudioTracks: async () => ({ tracks: [], current: null }),
  listSubtitleTracks: async () => ({ tracks: [], current: null }),
  selectAudioTrackThroughMainWorld: async () => ({ applied: true }),
  selectSubtitleTrackByIdThroughMainWorld: async () => ({ applied: true }),
}));

const CATALOG = {
  currentVideoId: '80000002',
  seasons: [
    {
      id: '9001',
      number: 1,
      title: '',
      episodes: [
        { id: '80000001', number: 1, title: 'Chapter One', current: false },
        { id: '80000002', number: 2, title: 'Chapter Two', current: true },
      ],
    },
  ],
};

const barProps = () => ({
  playing: true,
  duration: 3_725_000,
  autoPauseCue: false,
  loopCue: false,
  speed: 1,
  railOpen: false,
  panelOpen: false,
  onTogglePlay: vi.fn(),
  onPrev: vi.fn(),
  onReplay: vi.fn(),
  onReplaySlow: vi.fn(),
  onNext: vi.fn(),
  onToggleAutoPause: vi.fn(),
  onToggleLoop: vi.fn(),
  onSpeed: vi.fn(),
  onToggleRail: vi.fn(),
  onTogglePanel: vi.fn(),
  onSeek: vi.fn(),
  onWakeNative: vi.fn(),
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  listEpisodesThroughMainWorld.mockReset();
  vi.restoreAllMocks();
});

describe('PR #172 · the episodes trigger and a late catalog', () => {
  it('re-reads the catalog on the click, and opens OUR menu instead of the native one', async () => {
    // The graph is not hydrated yet, but Netflix's own episodes control is on
    // screen: that is what makes our trigger exist in the first place.
    const native = document.createElement('button');
    native.setAttribute('data-uia', 'control-episodes');
    const nativeClicked = vi.fn();
    native.addEventListener('click', nativeClicked);
    document.body.appendChild(native);

    listEpisodesThroughMainWorld
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(CATALOG);

    render(<PlayerBar {...barProps()} />);
    // The mount read came back empty…
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-kvl-episodes-popover]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('player.episodes') }));
    // …and the click found the graph.
    await waitFor(() => expect(document.querySelector('[data-kvl-episodes-popover]')).not.toBeNull());
    expect(listEpisodesThroughMainWorld, 'one retry, not a loop').toHaveBeenCalledTimes(2);
    expect(nativeClicked, 'the user never sees Netflix own drawer').not.toHaveBeenCalled();
    expect(screen.getByText('Chapter Two')).toBeTruthy();
    expect(nativePopupOpen(document), 'our menu is not a native popup').toBe(false);
  });

  it('falls back to the site menu only when the retry is empty too', async () => {
    const native = document.createElement('button');
    native.setAttribute('data-uia', 'control-episodes');
    const nativeClicked = vi.fn();
    native.addEventListener('click', nativeClicked);
    document.body.appendChild(native);

    listEpisodesThroughMainWorld.mockResolvedValue(null);

    render(<PlayerBar {...barProps()} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: t('player.episodes') }));
    await waitFor(() => expect(nativeClicked).toHaveBeenCalled());
    expect(document.querySelector('[data-kvl-episodes-popover]'), 'nothing to list').toBeNull();
  });

  it('names the catalog read after the video, so a new episode is not the old list', async () => {
    const video = document.createElement('video');
    document.body.appendChild(video);
    listEpisodesThroughMainWorld.mockResolvedValue(CATALOG);
    const { rerender } = render(<PlayerBar {...barProps()} video={video} />);
    await waitFor(() => expect(listEpisodesThroughMainWorld).toHaveBeenCalledTimes(1));

    // The player swaps the element when the episode changes: the catalog is
    // re-read, because the graph belongs to the video that is playing.
    const next = document.createElement('video');
    document.body.appendChild(next);
    rerender(<PlayerBar {...barProps()} video={next} />);
    await waitFor(() => expect(listEpisodesThroughMainWorld).toHaveBeenCalledTimes(2));
  });
});
