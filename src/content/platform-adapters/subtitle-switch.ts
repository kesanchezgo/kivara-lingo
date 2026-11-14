/**
 * Switch the subtitle track to the language being learned.
 *
 * The app does this; the user never opens a subtitle menu. Two mechanisms,
 * in order:
 *
 *  1. the player API (`setTimedTextTrack`) — clean, but on the current Netflix
 *     build it answers, returns, and does NOT change the track (verified live:
 *     `getTimedTextTrack()` still reports the old language afterwards);
 *  2. the player's own subtitle menu, clicked through with the display name the
 *     API itself gave us (never a hardcoded translation).
 *
 * Every step is verified by re-reading the current track: the function reports
 * what actually happened, not what was attempted.
 */
import { listSubtitleTracks, selectSubtitleTrackThroughMainWorld } from './netflix-main-bridge';
import { pickTimedTextTrack, type TimedTextTrackInfo } from './timed-text';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * The subtitle menu button Netflix renders in its control bar.
 *
 * Exactly this hook, verified on the real page: the old `[aria-label*="Audio"]
 * wildcard also matched unrelated controls (and would match a different
 * language's UI), and opening the wrong panel is worse than not opening one.
 */
const MENU_BUTTON = '[data-uia="control-audio-subtitle"]';

function currentLang(track: { bcp47?: string } | null | undefined): string {
  return (track?.bcp47 ?? '').split(/[-_]/)[0].toLowerCase();
}

/** Open the subtitle menu; false when the control is not on screen yet. */
async function openSubtitleMenu(): Promise<boolean> {
  const button = document.querySelector<HTMLElement>(MENU_BUTTON);
  if (!button) return false;
  // No size guard: the call is verified afterwards, and a hidden control just
  // answers with no menu (the caller reports the failure).
  button.click();
  await sleep(900);
  return document.querySelectorAll('[data-uia^="subtitle-item"]').length > 0;
}

async function closeSubtitleMenu(): Promise<void> {
  if (!document.querySelector('[data-uia^="subtitle-item"]')) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  await sleep(300);
}

/**
 * Click the menu row whose name the API reported. Netflix labels the rows with
 * the same display name (`subtitle-item-Inglés`), so no translation table is
 * involved and a UI in another language still matches.
 */
async function clickMenuRow(displayName: string): Promise<boolean> {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-uia^="subtitle-item"]')];
  const wanted = displayName.trim().toLowerCase();
  const row = rows.find((el) => (el.getAttribute('data-uia') ?? '').toLowerCase() === `subtitle-item-${wanted}`)
    ?? rows.find((el) => (el.textContent ?? '').trim().toLowerCase() === wanted);
  if (!row) return false;
  row.click();
  await sleep(700);
  return true;
}

export interface SubtitleSwitchResult {
  ok: boolean;
  via: 'api' | 'menu' | null;
  /** Track the player ended up on, when it could be read. */
  track?: TimedTextTrackInfo | null;
  /** Why no switch happened, for devLog. */
  reason?: string;
}

/**
 * Make `lang` the player's subtitle language. Resolves with what actually
 * happened; never throws (the caller only logs).
 */
export async function switchSubtitleToLanguage(lang: string): Promise<SubtitleSwitchResult> {
  const want = lang.split(/[-_]/)[0].toLowerCase();
  if (!want) return { ok: false, via: null, reason: 'no language' };

  const before = await listSubtitleTracks().catch(() => null);
  if (!before) return { ok: false, via: null, reason: 'no subtitle API' };
  if (currentLang(before.current) === want) return { ok: true, via: null, track: before.current ?? null, reason: 'already there' };

  const picked = pickTimedTextTrack(before.tracks, want);
  if (!picked) return { ok: false, via: null, reason: 'language not offered' };

  // 1) The player API.
  await selectSubtitleTrackThroughMainWorld(want).catch(() => undefined);
  await sleep(1_200);
  const afterApi = await listSubtitleTracks().catch(() => null);
  if (currentLang(afterApi?.current) === want) return { ok: true, via: 'api', track: afterApi?.current ?? null };

  // 2) The player's own menu, labelled with the API's display name.
  const name = picked.displayName ?? '';
  if (name && await openSubtitleMenu()) {
    const clicked = await clickMenuRow(name);
    await closeSubtitleMenu();
    if (clicked) {
      await sleep(900);
      const afterMenu = await listSubtitleTracks().catch(() => null);
      if (currentLang(afterMenu?.current) === want) return { ok: true, via: 'menu', track: afterMenu?.current ?? null };
    }
  }
  return { ok: false, via: null, reason: 'the player kept its track' };
}
