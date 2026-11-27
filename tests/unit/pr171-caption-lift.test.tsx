/**
 * PR #171 · the lift, RED-first.
 *
 * CI caught it: `measureLift` read `document.getElementById(...)?.shadowRoot`,
 * which is ALWAYS null because both hosts attach `mode: 'closed'` — so the host
 * height came back 0 and every caption box was measured against nothing (the
 * card never published a usable box: `boxesOf(...).card === null`).
 *
 * And the first cue of an episode arrives while the tray has ALREADY reported a
 * height: the component returns `null` with `cue === null`, the layer mounts
 * later, and with `barHeightPx` unchanged the lift effect never ran again — the
 * plate stayed at 0 and sat UNDER the tray (z-20 over z-10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { __registerShadowRootForTests } from '../../src/content/shadow-host';
import type { StudyBinding } from '../../src/content/ui/study';

const study: StudyBinding = {
  statusOf: () => 'new',
  detailOf: () => ({ status: 'new' }) as never,
  setStatus: () => {},
  inAnki: () => false,
  userStatusOf: () => undefined,
};

const CUE = { id: 'c1', text: 'the quick fox jumps', start: 0, end: 3000, language: 'en' };

beforeEach(() => {
  // happy-dom does no layout: the plate needs a real height (in layout px, the
  // unit `measureLift` reads) or the lift is legitimately 0.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-kivara-caption-box') ? 40 : 0;
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/**
 * The production shape: the overlay lives INSIDE the video host's CLOSED root,
 * so `host.shadowRoot` is null to every page-side reader — the registry the
 * mount path writes is the only handle. That is the difference the CI failure
 * was made of.
 */
function closedHost() {
  const host = document.createElement('div');
  host.id = 'kivara-lingo-video-host';
  const root = host.attachShadow({ mode: 'closed' });
  __registerShadowRootForTests(host, root);
  document.body.appendChild(host);
  const boundary = document.createElement('div');
  boundary.setAttribute('data-popover-boundary', '');
  boundary.style.height = '360px';
  root.appendChild(boundary);
  return boundary;
}

const overlay = (cue: typeof CUE | null, barHeightPx: number) => (
  <SubtitleOverlay
    subtitleStyles={{ keepNativeLineBreaks: false } as never}
    cue={cue}
    altCue={null}
    mode="learning"
    saveRequestKey={null}
    onSaveCard={async () => ({ ok: true })}
    onTokenHoverChange={() => {}}
    initialSavedWords={new Set()}
    playing={false}
    study={study}
    barHeightPx={barHeightPx}
  />
);

/** The layer, wherever it ended up (inside the closed root in production). */
const layerIn = (root: ParentNode) => root.querySelector<HTMLElement>('[data-kvl-caption-layer]');
const liftOf = (el: HTMLElement | null) => Number(el?.getAttribute('data-kvl-lift') ?? 0);

describe('PR #171 · the caption lifts when the first cue arrives', () => {
  it('goes from no layer (lift 0) to a real lift once the cue mounts', async () => {
    const boundary = closedHost();
    const { rerender } = render(overlay(null, 98), { container: boundary });
    // No cue: the overlay renders nothing, so there is no layer to lift.
    expect(layerIn(boundary), 'and nothing to measure').toBeNull();

    await act(async () => {
      rerender(overlay(CUE, 98));
    });
    await act(async () => { await Promise.resolve(); });

    const layer = layerIn(boundary);
    expect(layer, 'the layer is mounted').not.toBeNull();
    expect(liftOf(layer), 'and the plate is lifted clear of the chrome').toBeGreaterThan(0);
  });

  it('re-measures with the plate already mounted, without a new cue', async () => {
    // The plate's own re-wrap lands as a mutation, not as a new cue: the lift
    // has to follow it.
    const boundary = closedHost();
    const { rerender } = render(overlay(CUE, 98), { container: boundary });
    await act(async () => { await Promise.resolve(); });
    const first = liftOf(layerIn(boundary));
    expect(first).toBeGreaterThan(0);

    // A hidden chrome height (the tray at rest) drops the lift back to zero.
    await act(async () => { rerender(overlay(CUE, 0)); });
    await act(async () => { await Promise.resolve(); });
    expect(liftOf(layerIn(boundary)), 'no chrome, nothing to clear').toBe(0);
  });
});
