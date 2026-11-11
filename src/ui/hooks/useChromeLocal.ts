/**
 * React binding for `chromeLocalStore` (docs/REDESIGN-V2.md §4.3).
 *
 * The store itself is dependency-free; this hook subscribes the component and
 * hydrates the persisted value once. Used for per-device UI state (rail open,
 * transcript view, loop and speed) that must not travel through the synced
 * settings blob.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { ChromeLocalStore } from '../../shared/chrome-local-store';

export function useChromeLocal<T>(store: ChromeLocalStore<T>): T {
  const value = useSyncExternalStore(
    (listener) => store.subscribe(() => listener()),
    () => store.get(),
    () => store.get(),
  );
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return value;
}
