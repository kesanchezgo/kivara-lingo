/**
 * Deep link into Ajustes.
 *
 * The popover's "held back" strip is the one place the user can fix a word that
 * resolved without its dictionary sources, and a grant can only be raised from
 * a user gesture on the options page. The round trip is two halves that must
 * agree on the same key:
 *
 *  1. the content card sends OPEN_SETTINGS {section} through webext-bridge;
 *     the service worker writes the section here and opens the options page,
 *     because a content script cannot open it (options/ is not
 *     web-accessible, so window.open is blocked);
 *  2. SidePanel reads this key AND the URL hash on first render to pick the
 *     initial tab — the panel defaults to Cards, so without this the deep link
 *     landed on a tab that never mounts SettingsTab at all — and SettingsTab
 *     expands the matching accordion and scrolls to it.
 *
 * `chrome.storage.session` rather than `local`: it must survive the navigation
 * between the SW writing it and the options page reading it, and must not
 * outlive the profile.
 */
export const OPEN_SETTINGS_SECTION_KEY = 'kivara:open-settings-section';

/**
 * The section a deep link asked for, read the way both surfaces read it: the
 * URL hash first (reload-safe), then the session slot the bridge handler
 * writes. Plain `location.hash` is checked rather than a React Router value
 * because both the options page and the side panel render on raw URLs.
 */
export async function readOpenSettingsSection(): Promise<string | undefined> {
  // Hash wins and is left alone: it belongs to the URL, survives a reload and
  // must be able to re-open the section tomorrow.
  if (typeof window !== 'undefined' && window.location.hash) {
    return window.location.hash.replace('#', '').trim() || undefined;
  }
  // No hash: the slot the OPEN_SETTINGS handler wrote just before opening this
  // tab. The panel that renders the deep-linked surface consumes it, so it is
  // read and cleared in one step by the caller (see `clearOpenSettingsSection`).
  try {
    const raw = await chrome.storage.session.get(OPEN_SETTINGS_SECTION_KEY);
    const value = raw[OPEN_SETTINGS_SECTION_KEY];
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    // storage.session is only missing outside an extension context.
    return undefined;
  }
}

/** Consume the session slot so a second, non-deep-linked open of the panel
 *  does not jump back to the same section. The hash is left alone; it dies
 *  with a reload only if the caller asks for that. */
export async function clearOpenSettingsSection(): Promise<void> {
  try {
    await chrome.storage.session.remove(OPEN_SETTINGS_SECTION_KEY);
  } catch {
    // ignore — nothing to consume outside an extension context.
  }
}
