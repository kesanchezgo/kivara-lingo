/**
 * The permission gesture — the three-line MV3 trap this whole review
 * chain kept returning to. `chrome.permissions.request` MUST run
 * syntactically inside the user gesture's task: awaiting anything
 * (getAll, a store read, a void noop) between the click and the prompt
 * lets Chrome drop the gesture and the grant comes back `false`
 * without a prompt ever showing.
 *
 * This file pins `requestHosts` (the single call site, shared/host-permissions.ts):
 *  - `request` fires SYNCHRONOUSLY on invocation, before any await;
 *  - the answer decides the return value (granted -> empty list);
 *  - a throw falls back to the missing list, the UI is not stuck.
 * Falsified in review: moving any await ahead of `request` fails the
 * first case by construction (see the tick proof below).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRequestHosts() {
  vi.resetModules();
  const mod = await import('../../src/shared/host-permissions');
  return mod.requestHosts;
}

describe('requestHosts: the gesture', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fires permissions.request in the SAME TASK as the call', async () => {
    // The trap: if `request` were called after an await, the call would not
    // have happened by the time this synchronous line runs, and the count
    // would still be 0 here — no wall-clock, no waiting, no flake.
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('chrome', { permissions: { request } });
    const requestHosts = await loadRequestHosts();
    const promise = requestHosts(['https://www.youtube.com/*']);
    // still the same synchronous turn
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ origins: ['https://www.youtube.com/*'] });
    await promise;
  });

  it('reports nothing missing when the grant lands', async () => {
    vi.stubGlobal('chrome', { permissions: { request: vi.fn().mockResolvedValue(true) } });
    const requestHosts = await loadRequestHosts();
    await expect(requestHosts(['https://www.youtube.com/*'])).resolves.toEqual([]);
  });

  it('reports the origins still missing when the user declines', async () => {
    // getAll reports no granted origins, so missingHosts returns the input
    // list — the shape callers rely on for the "grant access" hint.
    vi.stubGlobal('chrome', {
      permissions: {
        request: vi.fn().mockResolvedValue(false),
        getAll: async () => ({ origins: [], permissions: [] }),
      },
    });
    const requestHosts = await loadRequestHosts();
    await expect(requestHosts(['https://a.example/*'])).resolves.toEqual(['https://a.example/*']);
  });

  it('falls back to the missing list when permissions.request throws', async () => {
    vi.stubGlobal('chrome', {
      permissions: {
        request: vi.fn().mockRejectedValue(new Error('denied')),
        getAll: async () => ({ origins: [], permissions: [] }),
      },
    });
    const requestHosts = await loadRequestHosts();
    await expect(requestHosts(['https://b.example/*'])).resolves.toEqual(['https://b.example/*']);
  });

  it('does nothing for an empty list', async () => {
    const request = vi.fn();
    vi.stubGlobal('chrome', { permissions: { request } });
    const requestHosts = await loadRequestHosts();
    await expect(requestHosts([])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
