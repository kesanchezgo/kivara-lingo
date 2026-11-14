/**
 * SPA navigation triggers — the Netflix dead-mount regression.
 *
 * On real Netflix, clicking play on /browse SPA-navigates to /watch but
 * `handleNavigation` never ran: the player framework had captured the native
 * `history.pushState` before the content script patched it, so its navigation
 * bypassed the patch, and `popstate` does not fire for pushState. Kivara
 * stayed idle with the video playing (QA stage A3, 22 s in, hosts 0/0).
 *
 * The triggers must therefore never depend on the page using OUR patched
 * method: Chrome's Navigation API fires for every navigation, and a cheap
 * href watchdog catches the rest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HREF_WATCHDOG_MS,
  installNavigationTriggers,
  type NavTriggersHost,
} from '../../src/content/nav-triggers';

interface FakeWindow extends NavTriggersHost {
  emit(type: string): void;
  /** An unpatched handle, as a framework that captured it early would hold. */
  capturedPush: (url: string) => void;
}

function makeWindow({ withNavApi }: { withNavApi: boolean }): FakeWindow {
  const listeners = new Map<string, Array<() => void>>();
  const navigate = (url: string | null | undefined) => {
    if (url) w.location.href = new URL(url, w.location.href).href;
  };
  const w = {
    location: { href: 'https://www.netflix.com/browse' },
    history: {
      pushState: (_data: unknown, _title: string, url?: string | null) => navigate(url),
      replaceState: (_data: unknown, _title: string, url?: string | null) => navigate(url),
    } as Pick<History, 'pushState' | 'replaceState'>,
    addEventListener(type: string, listener: () => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    setInterval: (handler: () => void, ms: number) => window.setInterval(handler, ms),
    clearInterval: (id: number) => window.clearInterval(id),
    emit(type: string) {
      for (const l of listeners.get(type) ?? []) l();
    },
  };
  const fake = w as unknown as FakeWindow;
  fake.capturedPush = (url: string) => {
    // A reference to the ORIGINAL implementation, exactly like the framework
    // that grabbed the method before installNavigationTriggers ran: the call
    // never touches the patched history, it only changes the URL.
    navigate(url);
  };
  if (withNavApi) {
    (w as unknown as { navigation: { addEventListener: (t: string, l: () => void) => void } }).navigation = {
      addEventListener: (type: string, listener: () => void) => {
        const list = listeners.get(`nav:${type}`) ?? [];
        list.push(listener);
        listeners.set(`nav:${type}`, list);
      },
    };
  }
  return fake;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('installNavigationTriggers', () => {
  it('detects a navigation made through a history handle captured before install', () => {
    const win = makeWindow({ withNavApi: false });
    const onChange = vi.fn();
    installNavigationTriggers(win, onChange);
    // The framework still holds the native pushState — our patch never runs.
    win.capturedPush('/watch/81234567');
    expect(onChange).not.toHaveBeenCalled(); // the patch alone cannot see it
    vi.advanceTimersByTime(HREF_WATCHDOG_MS + 50);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(win.location.href).toBe('https://www.netflix.com/watch/81234567');
  });

  it('fires on the Navigation API navigate event when the API exists', () => {
    const win = makeWindow({ withNavApi: true });
    const onChange = vi.fn();
    installNavigationTriggers(win, onChange);
    win.emit('nav:navigate');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not crash on engines without the Navigation API', () => {
    const win = makeWindow({ withNavApi: false });
    expect(() => installNavigationTriggers(win, vi.fn())).not.toThrow();
  });

  it('still reports a navigation through the patched history', () => {
    const win = makeWindow({ withNavApi: true });
    const onChange = vi.fn();
    installNavigationTriggers(win, onChange);
    win.history.pushState({}, '', '/watch/1');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stays silent on the watchdog when the URL did not change', () => {
    const win = makeWindow({ withNavApi: false });
    const onChange = vi.fn();
    installNavigationTriggers(win, onChange);
    vi.advanceTimersByTime(HREF_WATCHDOG_MS * 5);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('teardown stops the watchdog', () => {
    const win = makeWindow({ withNavApi: false });
    const onChange = vi.fn();
    const stop = installNavigationTriggers(win, onChange);
    stop();
    win.capturedPush('/watch/2');
    vi.advanceTimersByTime(HREF_WATCHDOG_MS * 3);
    expect(onChange).not.toHaveBeenCalled();
  });
});
