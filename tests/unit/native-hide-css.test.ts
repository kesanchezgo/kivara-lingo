/**
 * The CSS each platform adapter injects to hide the PLATFORM'S OWN captions
 * (`HIDE_NATIVE_CSS` in the intercepted adapters) must stay surgical: it may
 * hide the caption TEXT box and nothing else.
 *
 * Two failure shapes this pins shut, both shipped at one point:
 *  1. Generic attribute wildcards — `[class*="caption"]`,
 *     `[data-testid*="subtitle" i]` — match any element whose class/testid
 *     merely CONTAINS the word, which on Prime/Max/Disney+ includes the
 *     subtitle settings menu and whole control bars.
 *  2. Container selectors — `.btm-media-overlays` on Disney+ — hide a shell
 *     that can wrap the `<video>` and the player controls themselves.
 *
 * The strings are read out of the adapter SOURCES instead of imported: the
 * CSS ships as a template literal passed to `hideNativeCss`, and a
 * regression is a literal edit — importing the constant would hide nothing
 * about how it is written, while reading the file keeps the test honest
 * about the shipped string (same trick as the i18n parity suite).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

interface AdapterCss {
  platform: string;
  file: string;
  /**
   * Full class names that plausibly wrap the `<video>` and/or the player
   * controls on this platform. Exact-name matching on purpose: a fragment
   * match would need the banned `[class*=` wildcards (assertion 2 catches
   * those first). Each entry is a shell the adapter itself anchors on or a
   * generic player-shell name.
   */
  containerDenyList: string[];
  /** A hook only this platform's caption renderer uses. */
  platformHook: string;
}

const ADAPTERS: AdapterCss[] = [
  {
    platform: 'Prime Video',
    file: 'src/content/platform-adapters/prime-video.ts',
    containerDenyList: [
      // The two shells `getVideo()` queries for the <video>.
      'webPlayerSDKContainer',
      'atvwebplayersdk-player-container',
      // Generic player-shell names, in case Prime renames.
      'player',
      'video-player',
    ],
    platformHook: 'atvwebplayersdk-captions-text',
  },
  {
    platform: 'HBO Max',
    file: 'src/content/platform-adapters/hbo-max.ts',
    containerDenyList: [
      // The styled-components player wrapper fragments (kebab + Pascal form)
      // named in HBO_PLAYER_CONTAINER_SELECTORS.
      'player-container',
      'PlayerContainer',
      // Bitmovin's own all-inclusive UI container (video + controls).
      'bmpui-ui-playercontainer',
      // Generic player-shell names, in case Max renames.
      'player',
      'video-player',
    ],
    platformHook: 'bmpui-ui-subtitle-overlay',
  },
  {
    platform: 'Disney+',
    file: 'src/content/platform-adapters/disney-plus.ts',
    containerDenyList: [
      // The whole overlay layer (can wrap <video> + controls) and its
      // variant, plus the player shell `getVideo()` anchors on.
      'btm-media-overlays',
      'btm-media-media-overlays',
      'btm-media-player',
      // Generic player-shell names, in case Disney+ renames.
      'player',
      'video-player',
    ],
    platformHook: 'dss-subtitle-renderer-wrapper',
  },
];

function readAdapterCss(adapter: AdapterCss): string {
  const source = readFileSync(path.join(root, adapter.file), 'utf8');
  const match = source.match(/const HIDE_NATIVE_CSS = `([\s\S]*?)`;/);
  expect(match, `HIDE_NATIVE_CSS not found in ${adapter.file}`).not.toBeNull();
  return match![1];
}

/** One HIDE_NATIVE_CSS string is one rule block: selectors sit before the `{`. */
function splitSelectors(css: string): string[] {
  const selectorPart = css.slice(0, css.indexOf('{'));
  return selectorPart
    .split(',')
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);
}

/** The compound a rule applies to — the last one, after any combinator. */
function subjectOf(selector: string): string {
  const compounds = selector.split(/[\s>+~]+/).filter((c) => c.length > 0);
  return compounds[compounds.length - 1] ?? '';
}

describe('HIDE_NATIVE_CSS targets only the caption text', () => {
  for (const adapter of ADAPTERS) {
    describe(adapter.platform, () => {
      it('keeps a non-empty CSS naming a platform-specific caption hook', () => {
        const css = readAdapterCss(adapter);
        expect(css.trim().length, 'the hide CSS must not be emptied').toBeGreaterThan(0);
        expect(css, 'the caption text hook for this platform must be present').toContain(
          adapter.platformHook,
        );
        expect(css).toContain('display: none');
      });

      it('has no generic attribute-wildcard selectors', () => {
        const css = readAdapterCss(adapter);
        const wildcards = css.match(/\[[^\]]*\*=[^\]]*\]/g) ?? [];
        expect(
          wildcards,
          `[class*="…"] / [data-testid*="…"] wildcards also match subtitle menus and control bars: ${wildcards.join(', ')}`,
        ).toEqual([]);
      });

      it('never hides a container that plausibly wraps the <video> or the controls', () => {
        const css = readAdapterCss(adapter);
        for (const selector of splitSelectors(css)) {
          const subject = subjectOf(selector);
          const classes = [...subject.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(
            (m) => m[1],
          );
          const offenders = classes.filter((cls) => adapter.containerDenyList.includes(cls));
          expect(
            offenders,
            `selector "${selector}" hides a player container (${offenders.join(', ')}) — scope it to the caption text child instead`,
          ).toEqual([]);
        }
      });
    });
  }
});
