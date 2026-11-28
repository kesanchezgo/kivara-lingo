/**
 * PR #172 — Kivara's own Audio/Subtitles/Translation and Episodes menus.
 *
 * The player is mocked at the bridge: what these tests pin is OUR behaviour —
 * which command each choice sends, what it does to the store when subtitles are
 * switched off, that a manual choice tells the watcher to stand down, that
 * Escape closes the menu without letting the key reach the player, and that a
 * non-numeric episode id never becomes a URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PlayerTrackPopover } from '../../src/content/ui/PlayerTrackPopover';
import { PlayerEpisodesPopover, episodeWatchUrl } from '../../src/content/ui/PlayerEpisodesPopover';
import { t } from '../../src/shared/i18n';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import type { NetflixEpisodesCatalog } from '../../src/content/platform-adapters/netflix-episodes';

const listAudioTracks = vi.fn();
const listSubtitleTracks = vi.fn();
const selectAudioTrackThroughMainWorld = vi.fn(async (_trackId: string) => ({ applied: true }));
const selectSubtitleTrackByIdThroughMainWorld = vi.fn(async (_trackId: string | null) => ({ applied: true }));

vi.mock('../../src/content/platform-adapters/netflix-main-bridge', () => ({
  listAudioTracks: () => listAudioTracks(),
  listSubtitleTracks: () => listSubtitleTracks(),
  selectAudioTrackThroughMainWorld: (trackId: string) => selectAudioTrackThroughMainWorld(trackId),
  selectSubtitleTrackByIdThroughMainWorld: (trackId: string | null) => selectSubtitleTrackByIdThroughMainWorld(trackId),
}));

const AUDIO = [
  { trackId: 'A:1', bcp47: 'es', displayName: 'Español', isNative: true },
  { trackId: 'A:2', bcp47: 'en', displayName: 'English' },
];
const SUBS = [
  { trackId: 'T:es', bcp47: 'es', displayName: 'Español', rawTrackType: 'SUBTITLES' },
  { trackId: 'T:en', bcp47: 'en', displayName: 'English', rawTrackType: 'CLOSEDCAPTIONS' },
  { trackId: 'T:none', bcp47: '', displayName: 'Off', isNoneTrack: true },
  { trackId: 'T:img', bcp47: 'es', displayName: 'Imagen', isImageBased: true },
];

beforeEach(() => {
  listAudioTracks.mockResolvedValue({ tracks: AUDIO, current: AUDIO[1] });
  listSubtitleTracks.mockResolvedValue({ tracks: SUBS, current: SUBS[1] });
  selectAudioTrackThroughMainWorld.mockClear();
  selectSubtitleTrackByIdThroughMainWorld.mockClear();
  useKivaraStore.setState({
    subtitlesVisible: true,
    study: { ...useKivaraStore.getState().study, translation: 'visible' },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const renderTracks = async (props: Partial<Parameters<typeof PlayerTrackPopover>[0]> = {}) => {
  const onClose = vi.fn();
  const onManualChoice = vi.fn();
  const onFallbackNative = vi.fn();
  render(
    <div data-popover-boundary>
      <PlayerTrackPopover onClose={onClose} onManualChoice={onManualChoice} onFallbackNative={onFallbackNative} {...props} />
    </div>,
  );
  await act(async () => { await Promise.resolve(); });
  return { onClose, onManualChoice, onFallbackNative };
};

describe('PR #172 · the audio and subtitles menu', () => {
  it('lists both track sets, badges the original audio and marks the active ones', async () => {
    await renderTracks();
    const audio = screen.getByRole('region', { name: t('player.audio') });
    expect(within(audio).getByRole('menuitemradio', { name: /Español/ })).toBeTruthy();
    expect(within(audio).getByText(t('player.originalAudio'))).toBeTruthy();
    const subs = screen.getByRole('region', { name: t('player.subtitles') });
    expect(within(subs).getByRole('menuitemradio', { name: t('player.subtitlesOff') })).toBeTruthy();
    // The "off" pseudo-track is not a list entry, and image tracks cannot be read.
    expect(within(subs).queryByRole('menuitemradio', { name: /Imagen/ })).toBeNull();
    // Both columns have an "English": the active one is the AUDIO row.
    expect(within(audio).getByRole('menuitemradio', { name: /English/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('switches the audio through the bridge', async () => {
    await renderTracks();
    const audio = screen.getByRole('region', { name: t('player.audio') });
    fireEvent.click(within(audio).getByRole('menuitemradio', { name: /Español/ }));
    await act(async () => { await Promise.resolve(); });
    expect(selectAudioTrackThroughMainWorld).toHaveBeenCalledWith('A:1');
    expect(within(audio).getByRole('menuitemradio', { name: /Español/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('switches the subtitle by id and tells the watcher the user decided', async () => {
    const { onManualChoice } = await renderTracks();
    const subs = screen.getByRole('region', { name: t('player.subtitles') });
    fireEvent.click(within(subs).getByRole('menuitemradio', { name: /Español/ }));
    await act(async () => { await Promise.resolve(); });
    expect(onManualChoice, 'the automatic switch stands down').toHaveBeenCalled();
    expect(selectSubtitleTrackByIdThroughMainWorld).toHaveBeenCalledWith('T:es');
    expect(useKivaraStore.getState().subtitlesVisible).toBe(true);
  });

  it('turns the subtitles off through the Off row', async () => {
    const { onManualChoice } = await renderTracks();
    fireEvent.click(screen.getByRole('menuitemradio', { name: t('player.subtitlesOff') }));
    await act(async () => { await Promise.resolve(); });
    expect(selectSubtitleTrackByIdThroughMainWorld).toHaveBeenCalledWith(null);
    expect(onManualChoice).toHaveBeenCalled();
    expect(useKivaraStore.getState().subtitlesVisible, 'the reading layer stops too').toBe(false);
  });

  it('drives the translation mode from the footer', async () => {
    await renderTracks();
    const group = screen.getByRole('radiogroup', { name: t('tr.title') });
    fireEvent.click(within(group).getByRole('radio', { name: t('tr.blur') }));
    expect(useKivaraStore.getState().study.translation).toBe('blur');
    fireEvent.click(within(group).getByRole('radio', { name: t('tr.hidden') }));
    expect(useKivaraStore.getState().study.translation).toBe('hidden');
  });

  it('closes with Escape WITHOUT letting the key reach the player', async () => {
    const { onClose } = await renderTracks();
    const escapedToThePage = vi.fn();
    const stopSpy = vi.fn();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') escapedToThePage();
    });
    window.addEventListener('keydown', stopSpy);
    const panel = document.querySelector('[data-kvl-track-popover]')!;
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(escapedToThePage, 'the fullscreen handler never sees it').not.toHaveBeenCalled();
  });

  it('offers the site menu when the player exposes nothing', async () => {
    listAudioTracks.mockResolvedValue({ tracks: [], current: null });
    listSubtitleTracks.mockResolvedValue({ tracks: [], current: null });
    const { onFallbackNative } = await renderTracks();
    expect(screen.getByText(t('player.tracksUnavailable'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('player.openNativeMenu') }));
    expect(onFallbackNative).toHaveBeenCalled();
  });
});

const CATALOG: NetflixEpisodesCatalog = {
  currentVideoId: '9',
  seasons: [
    {
      id: '1', number: 1, title: 'Temporada 1',
      episodes: [
        { id: '1', number: 1, title: 'Uno', durationSec: 2_820, current: false },
        { id: '2', number: 2, title: 'Dos', durationSec: 2_940, synopsis: 'Una sinopsis larga que se recorta a dos líneas.', current: false },
        // A graph is page data: an id that is not a plain number must never
        // become a URL.
        { id: 'javascript:alert(1)', number: 3, title: 'Hostil', current: false },
      ],
    },
    {
      id: '2', number: 2, title: 'Temporada 2',
      episodes: [{ id: '9', number: 1, title: 'Tres', current: true }],
    },
  ],
};

describe('PR #172 · the episodes menu', () => {
  it('opens on the season of the episode being played, and marks it', async () => {
    render(<PlayerEpisodesPopover catalog={CATALOG} onClose={vi.fn()} />);
    const current = document.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain('Tres');
    expect(current?.textContent).toContain(t('player.currentEpisode'));
    // Season 2 is the one playing, so it is the one selected.
    expect(screen.getByRole('radio', { name: 'Temporada 2' }).getAttribute('aria-checked')).toBe('true');
  });

  it('switches season and shows its episodes with their runtime', async () => {
    render(<PlayerEpisodesPopover catalog={CATALOG} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Temporada 1' }));
    expect(screen.getByText('Uno')).toBeTruthy();
    expect(screen.getByText('Dos')).toBeTruthy();
    expect(screen.getByText(t('player.durationMin', { m: 47 }))).toBeTruthy();
    expect(screen.getByText(/sinopsis larga/)).toBeTruthy();
  });

  it('only ever navigates for a numeric episode id', async () => {
    expect(episodeWatchUrl('80057281')).toBe('https://www.netflix.com/watch/80057281');
    expect(episodeWatchUrl('80057281?x=1')).toBeNull();
    expect(episodeWatchUrl('javascript:alert(1)')).toBeNull();
    expect(episodeWatchUrl('')).toBeNull();

    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
    const onClose = vi.fn();
    render(<PlayerEpisodesPopover catalog={CATALOG} onClose={onClose} />);
    // A hostile id must never reach the address bar, even if the graph carries it.
    fireEvent.click(screen.getByRole('radio', { name: 'Temporada 1' }));
    assign.mockClear();
    fireEvent.click(screen.getByText('Hostil'));
    expect(assign, 'nothing navigated for a non-numeric id').not.toHaveBeenCalled();
    expect(onClose, 'and the menu stayed open').not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Uno'));
    expect(assign, 'a real episode id goes to /watch').toHaveBeenCalledWith('https://www.netflix.com/watch/1');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes with Escape without letting the key reach the player', () => {
    const onClose = vi.fn();
    const escapedToThePage = vi.fn();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') escapedToThePage();
    });
    render(<PlayerEpisodesPopover catalog={CATALOG} onClose={onClose} />);
    fireEvent.keyDown(document.querySelector('[data-kvl-episodes-popover]')!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(escapedToThePage).not.toHaveBeenCalled();
  });
});
