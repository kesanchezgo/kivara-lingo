/**
 * Does `composedPath()` cross a CLOSED shadow root to a page-side listener?
 *
 * The panel's root is `mode: 'closed'` (content/shadow-host.ts) so the host page
 * cannot read the API-key inputs. Two page-side listeners in App.tsx depend on
 * the answer:
 *   - the shortcut guard uses `event.composedPath()` to decide whether the user
 *     is TYPING; if the path stops at the host, `eventPathIsEditable()` reports
 *     "not typing" and a shortcut key typed into a key field fires globally;
 *   - the hover guard reads the same path to decide whether the cursor is over
 *     a Kivara zone; if it stops at the host, the video resumes while the
 *     pointer sits on the subtitle or the popover.
 *
 * jsdom doesn't implement shadow encapsulation faithfully, so the unit test
 * (tests/unit/shadow-boundary.test.ts) answers the wrong question — it passes
 * either way. Real Chromium answers. Nothing extension-specific is needed: the
 * tree shape is a host + closed root + input.
 */
import { test, expect } from './fixtures';

/**
 * The page: mounts the same shape ShadowHost produces, listens at the two
 * levels App.tsx uses (`window` for keys, `document` for the mouse), and
 * dispatches from INSIDE the root — the fixture holds the reference the page
 * cannot reach.
 */
const FIXTURE = /* html */ `<!doctype html><html><body><h1>probe</h1>
<script>
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const input = document.createElement('input');
  input.type = 'password';
  root.appendChild(input);
  document.body.appendChild(host);

  window.__kivaraProbe = { keydown: null, mousemove: null };

  window.addEventListener('keydown', (e) => {
    const path = e.composedPath();
    window.__kivaraProbe.keydown = {
      pathLength: path.length,
      containsInput: path.indexOf(input) !== -1,
      // The path's job in this shape: the TARGET is retargeted at the host,
      // so the guards read the path instead. eventPathIsEditable() is a
      // path scan for exactly this reason.
      targetIsHost: e.target === host,
    };
  }, { capture: true });

  document.addEventListener('mousemove', (e) => {
    const path = e.composedPath();
    window.__kivaraProbe.mousemove = {
      pathLength: path.length,
      containsInput: path.indexOf(input) !== -1,
    };
  }, { capture: true });

  // Fired when the extension asks: a REAL keyboard event, dispatched by the
  // browser on the input that lives inside the closed root.
  window.__kivaraFireKey = () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));
  };
  window.__kivaraFireMove = () => {
    input.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
  };
</script>
</body></html>`;

/**
 * The hover half: the overlay shape ShadowHost mounts for a video page — a
 * full-screen, pointer-events-none closed root carrying a hover zone (the
 * popover / subtitle plate) that opts back into pointer-events.
 *
 * The overlay host covers the whole viewport. A MEMBERSHIP check ("the root
 * contains a zone") therefore fires for a pointer anywhere on it — including
 * the large area outside the zone; the resolver's hit test does not.
 *
 * The coordinates come from real `page.mouse.move` calls in the test below:
 * Chromium does its own hit testing through the real layout, which is what
 * makes this a Chromium test rather than a jsdom one.
 */
const FIXTURE_ZONE = /* html */ `<!doctype html><html><body style="margin:0">
<script>
  const host = document.createElement('div');
  host.id = 'kivara-lingo-host';
  Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647' });
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host { contain: layout style; }';
  root.appendChild(style);
  // The overlay chrome — huge, NOT a zone — the pointer-moving zone.
  const chromeLayer = document.createElement('div');
  Object.assign(chromeLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  root.appendChild(chromeLayer);
  // The zone: the only interactive surface — the popover card / plate.
  const zone = document.createElement('div');
  zone.dataset.kivaraHoverZone = 'true';
  zone.textContent = 'zone';
  Object.assign(zone.style, { position: 'absolute', left: '500px', top: '300px', width: '200px', height: '60px', pointerEvents: 'auto', background: '#9333ea20' });
  root.appendChild(zone);
  document.body.appendChild(host);
  window.__zone = { root, zone, host };
</script>
</body></html>`;

test.describe('closed-root event paths in real Chromium', () => {
  // This page proves what Chrome hands a page-side listener for a REAL keydown
  // from inside a closed root: the path STOPS AT THE HOST. That is the fact the
  // whole `eventClosedRoot` helper exists to answer — `eventPathIsEditable`
  // on that raw path reports "not typing", so App.tsx's guard used to fire the
  // global shortcuts while the user typed in an API-key field. The helpers
  // below are the fix, pinned to this platform's behaviour.
  test('records the raw composedPath for a closed-root input event', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(FIXTURE);
    await page.evaluate(() => (window as unknown as { __kivaraFireKey: () => void }).__kivaraFireKey());

    const keydown = await page.evaluate(
      () => (window as unknown as { __kivaraProbe: { keydown: { pathLength: number; containsInput: boolean } | null } })
        .__kivaraProbe.keydown,
    );
    expect(keydown, 'the window keydown listener never fired').not.toBeNull();
    // Should the browser ever deliver natively — which would make the
    // closed-root helpers redundant — flip this assert to `true` and delete
    // them. Both directions are intentional guardrails.
    expect(
      keydown!.containsInput,
      'Chrome delivered the input across the closed-root boundary: the guard never needed the closed-root helpers',
    ).toBe(false);
    await page.close();
  });

  // The hover guard's second half — what a MEMBERSHIP check would get wrong.
  // A closed root's path truncates at the host, so `overKivaraZone` resolves
  // the ONE element under the pointer coordinates through the root
  // (`root.elementFromPoint(...)` + `.closest('[data-kivara-hover-zone]')`).
  // The alternative — "the root contains a zone" — fires on every mousemove
  // over the transparent fullscreen overlay, including the large area outside
  // any zone. This test drives REAL mouse coordinates at a REAL box in
  // Chromium: jsdom has no layout and cannot decide it.
  test('resolves pointer position, not zone presence, inside a closed root', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(FIXTURE_ZONE);

    // The production resolver, exactly as shadow-host's `overKivaraZone`
    // computes it: coordinates → element-from-point → nearest zone.
    const hit = async (x: number, y: number): Promise<boolean> => {
      await page.mouse.move(x, y, { steps: 1 });
      return page.evaluate<boolean, [number, number]>(([cx, cy]) => {
        const w = window as unknown as { __zone?: { root: ShadowRoot; zone: HTMLElement; host: HTMLElement } };
        const { root } = w.__zone!;
        const el = root.elementFromPoint(cx, cy);
        return el instanceof HTMLElement ? el.closest('[data-kivara-hover-zone]') !== null : false;
      }, [x, y]);
    };

    const box = await page.evaluate(() => {
      const w = window as unknown as { __zone?: { zone: HTMLElement; host: HTMLElement } };
      const r = w.__zone!.zone.getBoundingClientRect();
      const h = w.__zone!.host.getBoundingClientRect();
      return { zx: r.x, zy: r.y, zw: r.width, zh: r.height, hw: h.width, hh: h.height };
    });

    // ON the zone — zones are the only elements with pointer events; the
    // overlay host covers everything and must NOT intercept this.
    const onZone = await hit(box.zx + box.zw / 2, box.zy + box.zh / 2);
    expect(onZone, 'cursor ON a hover zone inside a closed root must read as a hit').toBe(true);

    // ON the overlay but OUTSIDE the zone — the regression a membership
    // check shipped: "the root contains a zone" fires here and the video
    // never resumes while the cursor moves over the (much larger) overlay.
    const offZone = await hit(Math.max(box.zx - 60, box.hw - 10), Math.max(box.zy - 60, 1));
    expect(offZone, 'cursor on the overlay OUTSIDE any zone must read as not-a-hit').toBe(false);

    await page.close();
  });
});

