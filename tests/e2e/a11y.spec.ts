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
 * The WCAG-tagged audits stay tag-scoped: axe's "best-practice" bucket
 * (landmarks, heading order on a 460px panel) would fail on decisions the
 * product makes on purpose. The one exception is the default-ruleset gate
 * below, which keeps every rule but blocks on `critical` impact only: its
 * 2026-11-12 scan of the four tabs found nothing critical, and the two
 * moderate findings on <html> (landmark-one-main, page-has-heading-one) are
 * documented debt, not gate failures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './fixtures';
import { auditClosedRoot, AXE_SOURCE, describeViolations, WCAG_TAGS, type AxeViolation } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_FIXTURE = fs.readFileSync(path.join(here, 'fixtures', 'player.html'), 'utf8');

/**
 * axe's browser bundle, taken from `@axe-core/playwright`'s OWN dependency
 * tree instead of a bare `require('axe-core')`.
 *
 * `axe-core` is not a direct dependency of this repo — it arrives as
 * `@axe-core/playwright`'s. Resolving it from the test file worked only while
 * pnpm happened to expose it at the top level; the honest resolution is from
 * the package that declares it, and it keeps the version locked to the same
 * one the builder uses.
 */
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

  test('the options page has no critical violations in the default ruleset', async ({ context, extensionId }) => {
    test.setTimeout(90_000);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    await page.locator('#kivara-panel-tab-settings').waitFor({ state: 'visible', timeout: 20_000 });

    // No `withTags`: the default ruleset is the widest axe runs, every rule
    // included. This gate blocks on `critical` impact only — the 2026-11-12
    // scan of these four tabs found zero critical violations, and the two
    // moderate findings on <html> (landmark-one-main, page-has-heading-one)
    // are documented debt, deliberately below the bar (see the header note).
    const critical: string[] = [];
    for (const tab of ['subtitles', 'vocab', 'cards', 'settings']) {
      await page.locator(`#kivara-panel-tab-${tab}`).click();
      await page.waitForTimeout(700);
      const results = await new AxeBuilder({ page }).analyze();
      for (const v of results.violations as unknown as AxeViolation[]) {
        if (v.impact !== 'critical') continue;
        critical.push(
          `${v.id} (${v.impact}): ${v.help}\n` +
            v.nodes.map((n) => `  - ${n.target.join(' ')}: ${n.summary?.replace(/\s+/g, ' ')}`).join('\n'),
        );
      }
    }
    expect(critical, critical.join('\n\n')).toEqual([]);
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
