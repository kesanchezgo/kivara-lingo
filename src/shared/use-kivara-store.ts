/**
 * React binding for the shared store — UI-only.
 *
 * store.ts builds the zustand store with `createStore` from zustand/vanilla so
 * that background modules importing mere constants (`DEFAULT_*`,
 * `PERSIST_STORE_KEY`) never pull React into their bundle — the service worker
 * imports store.ts and never renders. This module is the only place where the
 * store meets React: it binds the vanilla store with `useStore` and attaches
 * the imperative API (getState/setState/subscribe/persist) exactly the way
 * zustand's own `create` does. Import `useKivaraStore` from HERE in
 * components; import constants from ./store directly.
 */
import { useStore } from 'zustand/react';
import type { UseBoundStore } from 'zustand';
import { kivaraStore, type KivaraState } from './store';

export const useKivaraStore = Object.assign(
  ((selector?: (state: KivaraState) => unknown) =>
    useStore(kivaraStore, selector ?? ((s: KivaraState) => s))) as UseBoundStore<typeof kivaraStore>,
  kivaraStore,
);
