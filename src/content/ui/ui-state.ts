/**
 * Per-device UI state for the player (docs/REDESIGN-V2.md §4.3: "Transcripción
 * abierta, vista, nativo visible" lives in `chrome.storage.local`).
 *
 * The rail's open state and its Lines/Words view are interface state, not
 * preferences: they must not travel through the synced blob (H4) and they are
 * shared by every tab of this device through `onChanged`.
 */
import { createChromeLocalStore } from '../../shared/chrome-local-store';
import type { RailView } from './TranscriptRail';

export const railOpenStore = createChromeLocalStore<boolean>('kvl:ui.railOpen', false);

export const railViewStore = createChromeLocalStore<RailView>(
  'kvl:ui.railView',
  'lines',
  (raw) => (raw === 'words' ? 'words' : 'lines'),
);