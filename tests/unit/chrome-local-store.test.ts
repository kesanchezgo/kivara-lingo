/**
 * chromeLocalStore — the F0 persistence primitive for data that grows with the
 * user (word status, level profiles, recent cards): docs/REDESIGN-V2.md §4.3.
 *
 * What matters and is asserted here:
 *   • set() is synchronous for the UI once hydrated, the disk write is debounced;
 *   • two sets inside the window produce ONE write with the last value;
 *   • a write equal to the last one is skipped;
 *   • a set() made while hydrate() is in flight is queued and replayed on top
 *     of the stored value, so a functional updater sees the hydrated prev and
 *     nothing is lost;
 *   • flush() before hydration waits and writes the queued final value;
 *   • onChanged from another context shows up locally, our own echo does not;
 *   • `merge: 'keys'` merges record values key by key: a removed key
 *     disappears, a key the incoming map does not mention stays;
 *   • the default (replace) still adopts non-map values wholesale;
 *   • a corrupt persisted value leaves the initial value in place instead of
 *     throwing on hydrate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChromeLocalStore } from '../../src/shared/chrome-local-store';

type ChangesCb = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string,
) => void;

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

  it('updates synchronously after hydration and writes once after the debounce', async () => {
    vi.useFakeTimers();
    const storage = installFakeStorage();
    const store = createChromeLocalStore<{ n: number }>(KEY, { n: 0 });
    await store.hydrate();
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

  it('queues a set made while hydration is in flight and replays it with the hydrated prev', async () => {
    const storage = installFakeStorage();
    let release!: () => void;
    storage.get.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          release = () => resolve({ [KEY]: 5 });
        }),
    );
    const store = createChromeLocalStore<number>(KEY, 0);
    const hydration = store.hydrate();
    const updater = vi.fn((prev: number) => prev + 1);

    store.set(updater);
    // The stored value is not known yet, so the queued update is not applied.
    expect(store.get()).toBe(0);
    expect(updater).not.toHaveBeenCalled();

    release();
    await hydration;
    expect(updater).toHaveBeenCalledWith(5);
    expect(store.get()).toBe(6);
  });

  it('replays several queued sets in order, last write wins, one write', async () => {
    vi.useFakeTimers();
    const storage = installFakeStorage({ [KEY]: { a: 9 } });
    const store = createChromeLocalStore<Record<string, number>>(KEY, {});
    const seen: Array<Record<string, number>> = [];
    store.subscribe((v) => seen.push(v));

    store.set((prev) => ({ ...prev, a: prev.a + 1 }));
    store.set((prev) => ({ ...prev, b: prev.a + 1 }));
    store.set({ c: 3 });

    await store.hydrate();
    // The stored value is adopted first, the queue is then applied in order.
    expect(seen).toEqual([{ a: 9 }, { a: 10 }, { a: 10, b: 11 }, { c: 3 }]);
    expect(store.get()).toEqual({ c: 3 });

    await vi.advanceTimersByTimeAsync(320);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledWith({ [KEY]: { c: 3 } });
  });

  it('flush before hydration waits and writes the queued final value, not a stale one', async () => {
    const storage = installFakeStorage({ [KEY]: 10 });
    const store = createChromeLocalStore<number>(KEY, 0);

    store.set((prev) => prev + 1);
    store.set((prev) => prev * 2);
    await store.flush();

    expect(store.get()).toBe(22);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledWith({ [KEY]: 22 });
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

  describe('merge: keys', () => {
    it('merges keys written by two different contexts', () => {
      const store = createChromeLocalStore<Record<string, string>>(KEY, {}, undefined, { merge: 'keys' });

      // A first tab that had nothing writes `alpha`; a second one writes `beta`.
      changes!({ [KEY]: { oldValue: {}, newValue: { alpha: 'known' } } }, 'local');
      changes!({ [KEY]: { oldValue: {}, newValue: { beta: 'new' } } }, 'local');

      // `beta` was absent from the incoming map and from its oldValue: it stays.
      expect(store.get()).toEqual({ alpha: 'known', beta: 'new' });
    });

    it('drops a key the writer removed between oldValue and newValue', () => {
      const store = createChromeLocalStore<Record<string, string>>(KEY, {}, undefined, { merge: 'keys' });

      changes!({ [KEY]: { oldValue: {}, newValue: { alpha: 'known', beta: 'new' } } }, 'local');
      // The writer had both keys and dropped `beta`: it disappears here too.
      changes!({ [KEY]: { oldValue: { alpha: 'known', beta: 'new' }, newValue: { alpha: 'known' } } }, 'local');

      expect(store.get()).toEqual({ alpha: 'known' });
    });

    it('ignores its own echo and notifies once per accepted change', async () => {
      const store = createChromeLocalStore<Record<string, string>>(KEY, {}, undefined, { merge: 'keys' });
      const seen: Array<Record<string, string>> = [];
      store.subscribe((v) => seen.push(v));

      store.set({ alpha: 'known' });
      await store.flush();
      expect(seen).toEqual([{ alpha: 'known' }]);

      // Our own bytes come back through onChanged: no re-adopt, no second fire.
      changes!({ [KEY]: { oldValue: {}, newValue: { alpha: 'known' } } }, 'local');
      expect(seen).toHaveLength(1);
      expect(store.get()).toEqual({ alpha: 'known' });

      // A real change (this writer dropped `alpha` and added `beta`) fires once.
      changes!({ [KEY]: { oldValue: { alpha: 'known' }, newValue: { beta: 'new' } } }, 'local');
      expect(seen).toHaveLength(2);
      expect(store.get()).toEqual({ beta: 'new' });
    });

    it('replays a remote change that landed during hydration over the stored value', async () => {
      const storage = installFakeStorage();
      let release!: () => void;
      storage.get.mockImplementationOnce(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            release = () => resolve({ [KEY]: { alpha: 'known' } });
          }),
      );
      const store = createChromeLocalStore<Record<string, string>>(KEY, {}, undefined, { merge: 'keys' });
      const hydration = store.hydrate();

      // The other tab's write is newer than the value the read will return.
      changes!({ [KEY]: { oldValue: {}, newValue: { beta: 'new' } } }, 'local');
      release();
      await hydration;

      expect(store.get()).toEqual({ alpha: 'known', beta: 'new' });
    });

    it('supports a custom merge callback with base, incoming and removed keys', () => {
      const merge = vi.fn(
        (base: Record<string, string>, incoming: Record<string, string>) => ({ ...base, ...incoming }),
      );
      const store = createChromeLocalStore<Record<string, string>>(KEY, {}, undefined, { merge });

      changes!({ [KEY]: { oldValue: { gone: 'known' }, newValue: { fresh: 'new' } } }, 'local');

      expect(merge).toHaveBeenCalledTimes(1);
      expect(merge).toHaveBeenCalledWith({}, { fresh: 'new' }, new Set(['gone']));
      expect(store.get()).toEqual({ fresh: 'new' });
    });
  });

  it('replaces wholesale in replace mode, even for a map store', () => {
    const store = createChromeLocalStore<Record<string, string>>(KEY, {});

    changes!({ [KEY]: { oldValue: { alpha: 'known' }, newValue: { beta: 'new' } } }, 'local');

    expect(store.get()).toEqual({ beta: 'new' });
  });
});