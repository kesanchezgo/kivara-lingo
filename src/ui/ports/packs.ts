/**
 * PacksPort — the dictionary-pack boundary (docs/REDESIGN-V2.md §4.2, §4.6).
 *
 * Replaces the prototype's `mocks/dictPacks.ts`. Mirrors the existing service
 * worker messages `LIST_DICT_PACKS`, `INSTALL_DICT_PACK_FROM_URL` and
 * `DELETE_DICT_PACK`. Phase F4/F5 replaces the stub factory below with the real
 * `webext-bridge` client.
 *
 * WHY a port: a content script reads the SITE's IndexedDB, not the extension's,
 * so packs must go through the service worker (docs/REDESIGN-V2.md §3 H5).
 */
import type { DictPackInfo, InstallPackResult } from './types';

export interface PacksPort {
  /** Installed packs. Mirrors `LIST_DICT_PACKS` → `{ packs }`. */
  list(): Promise<DictPackInfo[]>;
  /** Download and import a pack from a URL. Mirrors `INSTALL_DICT_PACK_FROM_URL`. */
  installFromUrl(url: string): Promise<InstallPackResult>;
  /** Remove an installed pack by id. Mirrors `DELETE_DICT_PACK`. */
  remove(id: string): Promise<void>;
}

/**
 * Build a PacksPort from the injected engine. This is a thin stub: it only
 * forwards calls, so the view tree can mount before the real client lands.
 *
 * @deprecated Later phases replace this factory with the real service-worker client.
 */
export function createPacksPort(engine: PacksPort): PacksPort {
  return {
    list: () => engine.list(),
    installFromUrl: (url) => engine.installFromUrl(url),
    remove: (id) => engine.remove(id),
  };
}
