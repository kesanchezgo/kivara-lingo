/**
 * The logger gate (debt D5).
 *
 * A shipped bundle must not write to the user's console: `devLog` is silent
 * unless the build is a DEV build or the `kivaraDebug` flag is on. Before the
 * logger, the MAIN-world interceptor and the offscreen worker printed their
 * banner and per-recording lines to everyone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLogForTests,
  dbg,
  dbgOnce,
  devLog,
  initLogFlag,
  logEnabled,
} from '../../src/shared/logger';

/**
 * `__DEV__` is a build constant. In vitest it is undefined, so `devBuild()` is
 * false and ONLY the storage flag can open the gate — exactly the production
 * configuration this test is about.
 */
function setDebugFlag(on: boolean): void {
  const storage = (globalThis as unknown as {
    chrome: { storage: Record<string, unknown> };
  }).chrome.storage as Record<string, unknown>;
  storage.local = {
    get: async () => ({ kivaraDebug: on }),
    set: async () => {},
    remove: async () => {},
  };
  storage.onChanged = { addListener: () => {} };
}

afterEach(() => {
  vi.restoreAllMocks();
  setDebugFlag(false);
});

describe('devLog', () => {
  it('is silent by default: no production chatter', async () => {
    setDebugFlag(false);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    devLog('[Kivara Lingo] offscreen audio worker ready');
    expect(log).not.toHaveBeenCalled();
    expect(logEnabled()).toBe(false);
  });

  it('prints once the kivaraDebug flag is on', async () => {
    setDebugFlag(true);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    devLog('[Kivara Lingo] offscreen audio worker ready');
    expect(log).toHaveBeenCalledWith('[Kivara Lingo] offscreen audio worker ready');
    expect(logEnabled()).toBe(true);
  });

  it('survives a context with no chrome.storage (MAIN world, tests)', async () => {
    // The flag is module state: turn it back off before removing the API.
    setDebugFlag(false);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const original = (globalThis as unknown as { chrome?: unknown }).chrome;
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => initLogFlag()).not.toThrow();
    devLog('quiet');
    expect(log).not.toHaveBeenCalled();
    (globalThis as unknown as { chrome?: unknown }).chrome = original;
  });
});

describe('dbg', () => {
  it('shares the devLog gate: silent without the flag', async () => {
    __resetLogForTests();
    setDebugFlag(false);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    dbg('[Kivara Lingo] command:', 'toggle-panel');
    expect(log).not.toHaveBeenCalled();
    expect(logEnabled()).toBe(false);
  });

  it('prints once the kivaraDebug flag is on', async () => {
    __resetLogForTests();
    setDebugFlag(true);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    dbg('[Kivara Lingo] command:', 'toggle-panel');
    expect(log).toHaveBeenCalledWith('[Kivara Lingo] command:', 'toggle-panel');
  });
});

describe('dbgOnce', () => {
  it('logs one line per distinct argument tuple', async () => {
    __resetLogForTests();
    setDebugFlag(true);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    dbgOnce('[Kivara Lingo] unmapped custom combo:', 'Ctrl+K');
    dbgOnce('[Kivara Lingo] unmapped custom combo:', 'Ctrl+K');
    dbgOnce('[Kivara Lingo] unmapped custom combo:', 'Ctrl+Shift+K');
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, '[Kivara Lingo] unmapped custom combo:', 'Ctrl+K');
    expect(log).toHaveBeenNthCalledWith(2, '[Kivara Lingo] unmapped custom combo:', 'Ctrl+Shift+K');
  });

  it('records nothing while the gate is closed', async () => {
    __resetLogForTests();
    setDebugFlag(false);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    dbgOnce('suppressed'); // closed gate: the key must NOT be recorded
    setDebugFlag(true);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    dbgOnce('suppressed');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('dedupe resets only via __resetLogForTests', async () => {
    __resetLogForTests();
    setDebugFlag(true);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    dbgOnce('once-only');
    dbgOnce('once-only');
    expect(log).toHaveBeenCalledTimes(1);
    // The seam also clears the gate flag — re-open it after the reset.
    __resetLogForTests();
    setDebugFlag(true);
    initLogFlag();
    await new Promise((r) => setTimeout(r, 0));
    dbgOnce('once-only');
    expect(log).toHaveBeenCalledTimes(2);
  });
});
