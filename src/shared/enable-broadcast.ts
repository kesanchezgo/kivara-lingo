/**
 * PR #170 · 2 — the popup's "instant off" half.
 *
 * `setEnabled` only writes the store, and the store's cross-context path is a
 * 250 ms-debounced `chrome.storage` rehydrate (`store.ts`). A quarter of a
 * second in which the video keeps looping, the hosts stay mounted and the
 * native subtitles stay hidden is not "apagado".
 *
 * So the popup tells every tab directly. Only http(s) tabs: a `chrome://` page
 * or a devtools window has no content script, and messaging it rejects with a
 * confusing lastError that has nothing to do with the switch.
 */
export const SET_ENABLED_MESSAGE = 'SET_ENABLED';

export interface EnableBroadcastTabs {
  query: (info: Record<string, never>) => Promise<Array<{ id?: number; url?: string }>>;
  sendMessage: (tabId: number, message: { type: string; enabled: boolean }) => Promise<unknown>;
}

/** Tell every open http(s) tab the new switch state. Never throws. */
export async function broadcastEnabled(
  enabled: boolean,
  tabs: EnableBroadcastTabs = chrome.tabs as unknown as EnableBroadcastTabs,
): Promise<number> {
  let sent = 0;
  try {
    const open = await tabs.query({});
    await Promise.all(open.map(async (tab) => {
      if (tab.id == null || !/^https?:/i.test(tab.url ?? '')) return;
      try {
        await tabs.sendMessage(tab.id, { type: SET_ENABLED_MESSAGE, enabled });
        sent += 1;
      } catch {
        /* no content script on that tab yet: the storage sync still covers it */
      }
    }));
  } catch (error) {
    console.warn('[Kivara Lingo] SET_ENABLED broadcast failed', error);
  }
  return sent;
}
