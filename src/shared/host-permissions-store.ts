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
  return isGranted(origin, granted);
}

function isGranted(origin: string, granted: string[]): boolean {
  if (granted.includes(origin)) return true;
  try {
    const want = new URL(origin.replace(/\*$/, 'x'));
    return granted.some((g) => {
      try {
        const pattern = g.replace(/\*$/, 'x');
        const host = pattern.split('://')[1]?.split('/')[0] ?? '';
        if (host === '*') return true;
        if (host.startsWith('*.')) {
          return (
            want.hostname === host.slice(2) || want.hostname.endsWith(host.slice(1))
          );
        }
        return want.hostname === host;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
export function useGrantedOrigins(): string[] {
  return useSyncExternalStore(subscribeHostPermissions, getGrantedOrigins, () => []);
}
