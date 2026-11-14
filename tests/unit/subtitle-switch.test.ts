/**
 * The switch that actually lands.
 *
 * Live finding: `setTimedTextTrack(id)` answers, returns, and the player keeps
 * its Spanish track. So the app verifies the result and falls back to the
 * player's own menu, clicking the row labelled with the display name the API
 * reported (no hardcoded translation).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const player = vi.hoisted(() => ({
  current: { trackId: 'T:es', bcp47: 'es', displayName: 'Español' } as { trackId: string; bcp47: string; displayName: string } | null,
  tracks: [
    { trackId: 'T:es', bcp47: 'es', displayName: 'Español', trackType: 'PRIMARY', rawTrackType: 'SUBTITLES', isNoneTrack: false, isForcedNarrative: false },
    { trackId: 'T:en', bcp47: 'en', displayName: 'Inglés', trackType: 'PRIMARY', rawTrackType: 'SUBTITLES', isNoneTrack: false, isForcedNarrative: false },
  ],
  /** Set to true to emulate the build that ignores the API setter. */
  apiIgnored: true,
  selects: [] as string[],
}));

vi.mock('../../src/content/platform-adapters/netflix-main-bridge', () => ({
  listSubtitleTracks: async () => ({ tracks: player.tracks, current: player.current }),
  selectSubtitleTrackThroughMainWorld: async (lang: string) => {
    player.selects.push(lang);
    if (!player.apiIgnored) player.current = player.tracks.find((t) => t.bcp47 === lang) ?? player.current;
    return { trackId: 'x', bcp47: lang };
  },
}));

import { switchSubtitleToLanguage } from '../../src/content/platform-adapters/subtitle-switch';

/** The minimal slice of Netflix's subtitle menu the switcher drives. */
function mountMenu(): { clicks: string[] } {
  const clicks: string[] = [];
  document.body.innerHTML = `
    <button data-uia="control-audio-subtitle">Audio</button>
    <div>
      <div data-uia="subtitle-item-Español">Español</div>
      <div data-uia="subtitle-item-Inglés">Inglés</div>
    </div>`;
  const row = document.querySelector<HTMLElement>('[data-uia="subtitle-item-Inglés"]')!;
  row.addEventListener('click', () => {
    clicks.push('Inglés');
    player.current = player.tracks[1];
  });
  return { clicks };
}

describe('switchSubtitleToLanguage', () => {
  beforeEach(() => {
    player.current = player.tracks[0];
    player.selects.length = 0;
    player.apiIgnored = true;
    document.body.innerHTML = '';
  });

  it('uses the API when it works', async () => {
    player.apiIgnored = false;
    const result = await switchSubtitleToLanguage('en');
    expect(result).toMatchObject({ ok: true, via: 'api' });
    expect(player.selects).toEqual(['en']);
  });

  it('falls back to the player menu when the API is ignored', async () => {
    const menu = mountMenu();
    const result = await switchSubtitleToLanguage('en');
    expect(menu.clicks).toEqual(['Inglés']);
    expect(result).toMatchObject({ ok: true, via: 'menu' });
    expect(result.track?.bcp47).toBe('en');
  });

  it('reports failure instead of pretending, when nothing changes', async () => {
    const result = await switchSubtitleToLanguage('en');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/kept its track/);
  });

  it('does nothing when the language is already on', async () => {
    player.current = player.tracks[1];
    const result = await switchSubtitleToLanguage('en');
    expect(result).toMatchObject({ ok: true, reason: 'already there' });
    expect(player.selects).toEqual([]);
  });

  it('does nothing when the language is not offered', async () => {
    const result = await switchSubtitleToLanguage('fr');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not offered/);
  });
});

describe('the menu button selector', () => {
  beforeEach(() => {
    player.current = player.tracks[0];
    player.selects.length = 0;
    player.apiIgnored = true;
    document.body.innerHTML = '';
  });

  it('does not open a panel that only matches an aria-label', async () => {
    // Anything else that announces itself as "Audio" is not Netflix's
    // subtitle menu; the exact data-uia hook is the only one used.
    document.body.innerHTML = `
      <button aria-label="Audio">Audio</button>
      <div><div data-uia="subtitle-item-Inglés">Inglés</div></div>`;
    // A real row would select the track when clicked; with the wildcard
    // selector the switcher would open THIS panel and click it.
    document.querySelector<HTMLElement>('[data-uia="subtitle-item-Inglés"]')!
      .addEventListener('click', () => { player.current = player.tracks[1]; });
    const result = await switchSubtitleToLanguage('en');
    expect(result.ok).toBe(false);
    expect(player.current?.bcp47).toBe('es');
  });
});
