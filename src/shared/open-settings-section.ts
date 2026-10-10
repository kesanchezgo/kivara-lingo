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
 *  2. SidePanel consumes the section — hash first (it survives a reload), then
 *     the session slot — to pick its initial tab AND the accordion SettingsTab
 *     opens. The panel defaulted to Cards, so without this the deep link landed
 *     on a tab that never even mounts SettingsTab.
 *
 * `chrome.storage.session` rather than `local`: it must survive the navigation
 * between the SW writing it and the options page reading it, and must not
 * outlive the profile.
 */
export const OPEN_SETTINGS_SECTION_KEY = 'kivara:open-settings-section';

/**
 * Read the deep-link section AND consume the session slot in one step, whether
 * or not a hash was present. One-sided consumption is what leaked: with a hash
 * on the URL the slot was never taken, so the NEXT plain open of Options
 * consumed it and jumped to a section the user never asked for on that visit.
 * The hash itself is left on the URL — reload must be able to re-open it.
 */
export async function consumeOpenSettingsSection(): Promise<string | undefined> {
  // One SHARED promise for the page, not one per caller: React StrictMode runs
  // effects twice, and two independent consume() calls race — the second
  // `remove()` can land before either read sees the slot, and the deep-linked
  // section is gone. Caching the promise makes read-then-remove one sequence
  // however many surfaces ask.
  consumePromise ??= (async () => {
    const fromHash =
      typeof window !== 'undefined' && window.location.hash
        ? window.location.hash.replace('#', '').trim()
        : '';
    try {
      const raw = await chrome.storage.session.get(OPEN_SETTINGS_SECTION_KEY);
      const value = raw[OPEN_SETTINGS_SECTION_KEY];
      const slot = typeof value === 'string' && value ? value : undefined;
      if (slot) await chrome.storage.session.remove(OPEN_SETTINGS_SECTION_KEY);
      // Hash wins: it is explicit on the URL, and the slot is cleared above
      // either way so no stale section is left behind.
      return fromHash || slot;
    } catch {
      // storage.session is only missing outside an extension context.
      return fromHash || undefined;
    }
  })();
  return consumePromise;
}

/** Per-page latch around the read-and-remove sequence above. */
let consumePromise: Promise<string | undefined> | undefined;
