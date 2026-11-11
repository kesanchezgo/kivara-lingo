/**
 * Tiny external store so any UI can render "this provider needs access"
 * without re-reading `chrome.permissions` on every mount. The content scripts
 * and the panel subscribe; the SW does not (it never renders).
 *
 * No React import here on purpose: the SW graph reaches this module (via
 * shared/host-permissions.ts), and a module-scope `useSyncExternalStore`
 * import used to drag all of React into the worker bundle. The hook lives in
 * the consumer (app/components/HostPermissionsRow.tsx).
 */

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

