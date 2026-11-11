/**
 * F9 accessibility gate (docs/REDESIGN-V2.md §7 F9, §8).
 *
 * Two surfaces, two techniques:
 *
 *  - **Panel**: `chrome-extension://<id>/src/options/index.html` is a normal
 *    page, so @axe-core/playwright runs it as-is.
 *  - **Overlay**: the subtitle overlay lives in a CLOSED shadow root
 *    (content/shadow-host.ts) — the point of that root is that the page can
 *    never query into it, and neither can `AxeBuilder.include()`. The test
 *    injects axe-core into the page and asks the DevTools DOM domain
 *    (`DOM.getDocument({ pierce: true })`) for a node inside the root; that
 *    node's `getRootNode()` is then handed to `axe.run()` through
 *    `Runtime.callFunctionOn`. The audit runs on the real closed tree with the
 *    real stylesheet, without opening the root the product deliberately hides.
 *
 * WCAG tag set only: ax's "best-practice" bucket (landmarks, heading order on
 * a 460px panel) would fail on decisions the product makes on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_FIXTURE = fs.readFileSync(path.join(here, 'fixtures', 'player.html'), 'utf8');
const require = createRequire(import.meta.url);
const AXE_SOURCE = (require('axe-core') as { source: string }).source;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: (string | number)[]; summary: string | null }[];
};

/** Human-readable failure text: rule, node, and axe's own summary. */
function describeViolations(violations: AxeViolation[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n` +
        v.nodes.map((n) => `  - ${n.target.join(' ')}: ${n.summary?.replace(/\s+/g, ' ')}`).join('\n'),
    )
    .join('\n\n');
}

type CdpNode = {
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  shadowRootType?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
};

function attr(node: CdpNode, name: string): string | null {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return attrs[i + 1];
  }
  return null;
}

function findById(node: CdpNode, id: string): CdpNode | null {
  if (attr(node, 'id') === id) return node;
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Runs axe inside the CLOSED shadow root that holds `rootId`, returning its
 * violations plus how many elements the context actually contained (so an
 * empty audit cannot pass as green).
 */
async function auditClosedRoot(
  page: Page,
  rootId: string,
): Promise<{ violations: AxeViolation[]; elements: number; words: number }> {
  await page.addScriptTag({ content: AXE_SOURCE });
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = (await client.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: CdpNode };
    const target = findById(root, rootId);
    if (!target) throw new Error(`#${rootId} not found, even with shadow piercing`);

    const { object } = (await client.send('DOM.resolveNode', { backendNodeId: target.backendNodeId })) as {
      object: { objectId?: string };
    };
    if (!object.objectId) throw new Error(`could not resolve #${rootId} to a JS object`);

    const response = (await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function () {
        if (typeof axe === 'undefined') return { elements: -1, violations: [], note: 'axe missing' };
        // axe resolves a context node against the flattened tree built from
        // document (see Context/parseSelectorArray in axe-core): nodes behind a
        // CLOSED root are not in it, so axe.run(closedChild) reports "no
        // elements found". The fix is a faithful OPEN clone: same hosts
        // attributes/classes, same style elements, same React subtree. The
        // live tree is never modified beyond adding the hidden clone, which is
        // removed in the finally.
        var sourceRoot = this.getRootNode();
        var sourceHost = sourceRoot.host;
        var cloneHost = document.createElement('div');
        for (var i = 0; i < sourceHost.attributes.length; i++) {
          var a = sourceHost.attributes[i];
          cloneHost.setAttribute(a.name, a.value);
        }
        cloneHost.style.cssText = sourceHost.style.cssText;
        cloneHost.style.position = 'fixed';
        cloneHost.style.inset = '0';
        var openRoot = cloneHost.attachShadow({ mode: 'open' });
        for (var j = 0; j < sourceRoot.childNodes.length; j++) {
          openRoot.appendChild(sourceRoot.childNodes[j].cloneNode(true));
        }
        document.body.appendChild(cloneHost);
        return axe.run(openRoot, {
          resultTypes: ['violations'],
          runOnly: { type: 'tag', values: ${JSON.stringify(WCAG_TAGS)} },
        }).then(function (report) {
          return {
            elements: openRoot.querySelectorAll('*').length,
            words: openRoot.querySelectorAll('[data-tok-idx]').length,
            violations: report.violations.map(function (v) {
              return {
                id: v.id,
                impact: v.impact,
                help: v.help,
                nodes: v.nodes.map(function (n) {
                  return { target: n.target, summary: n.failureSummary };
                }),
              };
            }),
          };
        }).finally(function () {
          cloneHost.remove();
        });
      }`,
      awaitPromise: true,
      returnByValue: true,
    })) as {
      result: { value?: { violations: AxeViolation[]; elements: number; words?: number; note?: string } };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };

    if (response.exceptionDetails) {
      throw new Error(
        `axe failed inside the closed root: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`,
      );
    }
    const value = response.result.value;
    if (!value) throw new Error('axe.run returned no value');
    if (value.elements < 0) throw new Error(`axe missing in the page context: ${value.note}`);
    return { violations: value.violations, elements: value.elements, words: value.words ?? 0 };
  } finally {
    await client.detach().catch(() => {});
  }
}

test.describe('accessibility', () => {
  test('the options panel has no WCAG A/AA violations', async ({ context, extensionId }) => {
    test.setTimeout(90_000);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    await page.locator('#kivara-panel-tab-settings').waitFor({ state: 'visible', timeout: 20_000 });

    // Every tab, not just the first one: the panel keeps all four mounted, so
    // an audit of the default tab is an audit of a quarter of the surface.
    for (const tab of ['subtitles', 'vocab', 'cards', 'settings']) {
      await page.locator(`#kivara-panel-tab-${tab}`).click();
      // Let the tab's entrance animation (kvl-stagger, 320 ms + 200 ms of
      // delays) finish: axe reads computed colours, and mid-animation opacity
      // produces contrast failures that do not exist once the UI settles.
      await page.waitForTimeout(700);
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations,
        `tab "${tab}"\n${describeViolations(results.violations as unknown as AxeViolation[])}`,
      ).toEqual([]);
    }

    // Visible focus: a keyboard Tab must land on a control that actually shows
    // an indicator (the theme's FOCUS ring or the global :focus-visible
    // outline). axe cannot test this.
    await page.locator('#kivara-panel-tab-settings').focus();
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        outline: `${s.outlineStyle} ${s.outlineWidth}`,
        shadow: s.boxShadow,
      };
    });
    expect(focus).not.toBeNull();
    const hasOutline = focus!.outline.startsWith('solid') && focus!.outline !== 'solid 0px';
    const hasRing = focus!.shadow !== 'none';
    expect(hasOutline || hasRing, `no focus indicator on ${focus!.tag}: ${JSON.stringify(focus)}`).toBe(true);
  });

  test('the panel respects prefers-reduced-motion', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    await page.locator('#kivara-panel-tab-settings').waitFor({ state: 'visible', timeout: 20_000 });

    const motion = await page.evaluate(() => {
      const stagger = document.querySelector('.kvl-stagger > *');
      const press = document.querySelector('.kvl-press');
      return {
        staggerAnimation: stagger ? getComputedStyle(stagger).animationName : null,
        pressTransition: press ? getComputedStyle(press).transitionDuration : null,
      };
    });
    // The panel body uses kvl-stagger and every button uses kvl-press; both
    // are the theme's own motion, not Tailwind's loading spinners.
    expect(motion.staggerAnimation).toBe('none');
    expect(motion.pressTransition).toBe('0s');
  });

  test('the subtitle overlay has no WCAG A/AA violations inside the closed root', async ({ context }) => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    await page.route('*://*.youtube.com/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('cues.vtt')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/vtt',
          body: 'WEBVTT\n\n00:00:00.000 --> 00:00:09.000\nHello, this is a test cue with several words.\n',
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: PLAYER_FIXTURE });
    });

    await page.goto('https://www.youtube.com/watch?v=kivara-a11y');
    await page.bringToFront();
    await page.waitForFunction(
      () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady === true,
      undefined,
      { timeout: 30_000 },
    );
    // The overlay host proves App mounted; the audit itself reads the closed
    // root through the DevTools protocol.
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('#kivara-lingo-video-host').length), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 0.5, undefined, {
      timeout: 20_000,
    });
    // Give the cue → token render a beat (the overlay paints on the cue poll).
    await page.waitForTimeout(1_500);

    const { violations, elements, words } = await auditClosedRoot(page, 'kivara-lingo-video-react-root');
    // The audit must have had a real subtree to look at, including the
    // subtitle line: with no tokens it would be auditing the empty chrome.
    expect(elements).toBeGreaterThan(10);
    expect(words).toBeGreaterThan(0);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});
