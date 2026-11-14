/**
 * Point 1 of the #119 fixes — nothing happens with Kivara OFF.
 *
 * Verified on the fixture: with the popup switch off, the page recorded 9
 * `setTimedTextTrack('T:en')` calls in ~9 s. The watcher must not touch the
 * player at all while the extension is disabled, and must resume when it is
 * turned back on.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSubtitleTrackWatcher, type SubtitleTrackWatcherDeps } from '../../src/content/platform-adapters/subtitle-track-watcher';

function harness(overrides: Partial<SubtitleTrackWatcherDeps> = {}) {
  let enabled = true;
  let lang = 'en';
  let busHas: string | null = null;
  const switches: string[] = [];
  const enabledListeners = new Set<() => void>();
  const trackListeners = new Set<(l: string) => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const deps: SubtitleTrackWatcherDeps = {
    isEnabled: () => enabled,
    learningLang: () => lang,
    hasTrackFor: (l) => busHas === l,
    switchTo: async (l) => {
      switches.push(l);
      return { ok: true };
    },
    onTrack: (listener) => {
      trackListeners.add(listener);
      return () => trackListeners.delete(listener);
    },
    subscribeEnabled: (listener) => {
      enabledListeners.add(listener);
      return () => enabledListeners.delete(listener);
    },
    setInterval: (handler) => {
      const id = nextTimer++;
      timers.set(id, handler);
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id);
    },
    log: () => {},
    ...overrides,
  };

  return {
    deps,
    switches,
    setEnabled(next: boolean) {
      enabled = next;
      enabledListeners.forEach((l) => l());
    },
    setLang(next: string) {
      lang = next;
    },
    setBusTrack(next: string | null) {
      busHas = next;
    },
    fireTrack(language: string) {
      trackListeners.forEach((l) => l(language));
    },
    tickAll() {
      [...timers.values()].forEach((h) => h());
    },
    running: () => timers.size > 0,
    trackListeners: () => trackListeners.size,
  };
}

describe('subtitle track watcher — the master switch', () => {
  it('does nothing at all while Kivara is off', async () => {
    const h = harness();
    h.setEnabled(false);
    const watcher = createSubtitleTrackWatcher(h.deps);
    watcher.start();

    h.tickAll();
    h.fireTrack('es');
    await Promise.resolve();

    expect(h.switches).toEqual([]);
    expect(h.running()).toBe(false);
    watcher.stop();
  });

  it('acts once Kivara is on', async () => {
    const h = harness();
    h.setEnabled(false);
    const watcher = createSubtitleTrackWatcher(h.deps);
    watcher.start();
    expect(h.switches).toEqual([]);

    h.setEnabled(true);
    await Promise.resolve();
    h.fireTrack('es');
    await Promise.resolve();

    expect(h.switches).toContain('en');
    watcher.stop();
  });

  it('stops the loop when Kivara is switched off mid-episode', async () => {
    const h = harness();
    const watcher = createSubtitleTrackWatcher(h.deps);
    watcher.start();
    await Promise.resolve();
    expect(h.running()).toBe(true);

    h.setEnabled(false);
    expect(h.running()).toBe(false);
    expect(h.trackListeners()).toBe(0);

    h.tickAll();
    h.fireTrack('es');
    await Promise.resolve();
    // Only the initial attempt from start() is allowed.
    expect(h.switches).toHaveLength(1);
    watcher.stop();
  });

  it('does not ask again when the bus already has the learning track', async () => {
    const h = harness();
    h.setBusTrack('en');
    const watcher = createSubtitleTrackWatcher(h.deps);
    watcher.start();
    h.fireTrack('es');
    await Promise.resolve();
    expect(h.switches).toEqual([]);
    watcher.stop();
  });
});
