/**
 * chromeLocalStore — the F0 persistence primitive for data that grows with the
 * user (word status, level profiles, recent cards): docs/REDESIGN-V2.md §4.3.
 *
 * What matters and is asserted here:
 *   • set() is synchronous for the UI, the disk write is debounced;
 *   • two sets inside the window produce ONE write with the last value;
 *   • a write equal to the last one is skipped;
 *   • onChanged from another context shows up locally, our own echo does not;
 *   • a corrupt persisted value leaves the initial value in place instead of
 *     throwing on hydrate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeLocalStore } from '../../src/shared/chrome-local-store';

type ChangesCb = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

const KEY = 'kvl:test';
let changes: ChangesCb | null = null;

interface FakeStorage {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

function installFakeStorage(stored: Record<string, unknown> = {}): FakeStorage {
  const fake: FakeStorage = {
    get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(stored, items);
    }),
  };
  (globalThis as unknown as { chrome: Record<string, unknown> }).chrome.storage = {
    local: fake,
    onChanged: {
      addListener: (cb: ChangesCb) => {
        changes = cb;
      },
    },
  };
  return fake;
}

beforeEach(() => {
  changes = null;
  installFakeStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createChromeLocalStore', () => {
  it('returns the initial value before hydration', () => {
    const store = createChromeLocalStore<number>(KEY, 7);
    expect(store.get()).toBe(7);
  });

  it('updates synchronously and writes once after the debounce', async () => {
    vi.useFakeTimers();
    const storage = installFakeStorage();
    const store = createChromeLocalStore<{ n: number }>(KEY, { n: 0 });
    const seen: number[] = [];
    store.subscribe((v) => seen.push(v.n));

    store.set({ n: 1 });
    store.set((prev) => ({ n: prev.n + 1 }));
    expect(store.get()).toEqual({ n: 2 });
    expect(seen).toEqual([1, 2]);
    expect(storage.set).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(320);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledWith({ [KEY]: { n: 2 } });
  });

  it('skips a write that carries the same bytes as the persisted value', async () => {
    vi.useFakeTimers();
    const storage = installFakeStorage({ [KEY]: { n: 1 } });
    const store = createChromeLocalStore<{ n: number }>(KEY, { n: 0 });
    await store.hydrate();
    // Same value the store just adopted from disk: nothing to write.
    store.set({ n: 1 });
    await vi.advanceTimersByTimeAsync(320);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('hydrates a stored value through revive', async () => {
    installFakeStorage({ [KEY]: { n: 4 } });
    const store = createChromeLocalStore<number>(
      KEY,
      0,
      (raw) => (raw as { n: number }).n,
    );
    await store.hydrate();
    expect(store.get()).toBe(4);
  });

  it('keeps the initial value when the stored value is corrupt', async () => {
    installFakeStorage({ [KEY]: { broken: true } });
    const store = createChromeLocalStore<number>(KEY, 3, () => {
      throw new Error('bad shape');
    });
    await expect(store.hydrate()).resolves.toBeUndefined();
    expect(store.get()).toBe(3);
  });

  it('adopts changes from another context and ignores its own echo', async () => {
    const store = createChromeLocalStore<{ n: number }>(KEY, { n: 0 });
    expect(changes).toBeTypeOf('function');

    changes!({ [KEY]: { newValue: { n: 9 } } }, 'local');
    expect(store.get()).toEqual({ n: 9 });

    // Our own write comes back through onChanged: same bytes, no re-adopt and
    // no listener bounce.
    const seen: number[] = [];
    store.subscribe((v) => seen.push(v.n));
    store.set({ n: 11 });
    await store.flush();
    changes!({ [KEY]: { newValue: { n: 11 } } }, 'local');
    expect(store.get()).toEqual({ n: 11 });
    expect(seen).toEqual([11]);
  });

  it('flush writes immediately instead of waiting for the debounce', async () => {
    const storage = installFakeStorage();
    const store = createChromeLocalStore<number>(KEY, 0);
    store.set(5);
    await store.flush();
    expect(storage.set).toHaveBeenCalledWith({ [KEY]: 5 });
  });
});