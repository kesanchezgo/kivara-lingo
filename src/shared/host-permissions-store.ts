/**
 * Tiny external store so any UI can render "this provider needs access"
 * without re-reading `chrome.permissions` on every mount. The content scripts
 * and the panel subscribe; the SW does not (it never renders).
 */
import { useSyncExternalStore } from 'react';

let granted: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Re-read the granted origin list. Call after a grant/revoke and on boot. */
export async function refreshHostPermissions(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.getAll) {
    granted = [];
    loaded = true;
    emit();
    return;
  }
  try {
    const all = await chrome.permissions.getAll();
    granted = all.origins ?? [];
  } catch {
    granted = [];
  }
  loaded = true;
  emit();
}

export function subscribeHostPermissions(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) void refreshHostPermissions();
  return () => listeners.delete(listener);
}

export function getGrantedOrigins(): string[] {
  return granted;
}

export function hasOrigin(origin: string): boolean {
  if (granted.includes(origin)) return true;
  try {
    const want = new URL(origin);
    return granted.some((g) => {
      try {
        return new URL(g).hostname === want.hostname;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** React hook mirroring the granted origin list. */
export function useGrantedOrigins(): string[] {
  return useSyncExternalStore(subscribeHostPermissions, getGrantedOrigins, () => []);
}
