/**
 * The E2E bridge must never ship.
 *
 * `src/e2e/index.html` and the `KIVARA_E2E_` door in the service worker exist
 * only to let Playwright drive the *production* handlers from a page. A
 * production bundle containing either one would mean any page in the
 * extension could start tab capture or extract clips through a channel that
 * does not check anything — and anything reachable is attackable.
 *
 * So this test does what the PR checklist says: run the real production build
 * (no `KIVARA_E2E`), then assert on `dist/` that neither the page nor the
 * door is there. Reading the bundle is the only honest check — the E2E code
 * lives in `src/`, and `tsc` cannot see what vite drops.
 *
 * Cost: one build per Vitest run. That is deliberate and bounded.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist');
const FORBIDDEN_TEXT = [
  // The bridge door: message types used only by the e2e listener.
  'KIVARA_E2E_START_AUDIO_CAPTURE',
  'KIVARA_E2E_EXTRACT_AUDIO_CLIP',
  // The synthetic-stream escape hatch in the offscreen recorder.
  'kivara-e2e-synthetic',
];
const FORBIDDEN_PATHS = [
  // The page and its bundle.
  /(^|\/)e2e\//,
];

/** Text of every non-binary file in `dist/`, mapped by relative path. */
function distFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
        continue;
      }
      // Binary assets cannot contain the markers; minified text files can.
      if (/\.(png|csv|svg|woff2?|ttf|eot|ico)$/i.test(abs)) continue;
      out.push({ rel: relPath, text: readFileSync(abs, 'utf8') });
    }
  };
  walk(DIST, '');
  return out;
}

describe('a production build contains no e2e bridge', () => {
  it(
    'greps the built dist for the bridge and its window',
    () => {
      // Stash any existing dist first: this asserts what the BUILD produces,
      // not what happened to be lying in the output folder beforehand.
      if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
      execFileSync('npx', ['vite', 'build'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 180_000,
      });

      const files = distFiles();
      expect(files.length, 'the build produced no dist at all').toBeGreaterThan(0);

      for (const { rel, text } of files) {
        for (const marker of FORBIDDEN_TEXT) {
          expect(
            text.includes(marker),
            `${rel} contains "${marker}" — the production build must not include it`,
          ).toBe(false);
        }
        for (const pattern of FORBIDDEN_PATHS) {
          expect(
            pattern.test(rel),
            `${rel} matches the e2e-only path pattern ${pattern} — production must not ship it`,
          ).toBe(false);
        }
      }
    },
    240_000,
  );

  it('does not open the worker to any page outside the extension', () => {
    const manifestPath = path.join(DIST, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      externally_connectable?: { matches?: unknown };
    };
    // Absent / empty means no external page can message the worker, which is
    // what keeps the (production-absent) bridge unreachable even if it existed.
    expect(manifest.externally_connectable?.matches ?? []).toEqual([]);
  });

  it('left no e2e-only input in the built manifest', () => {
    const manifestPath = path.join(DIST, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const serialized = JSON.stringify(manifest);
    expect(serialized.toLowerCase()).not.toContain('kivara_e2e');
  });
});
