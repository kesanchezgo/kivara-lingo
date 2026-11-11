/**
 * Trimmed icon generator gate (docs/REDESIGN-V2.md §3 H7, §8).
 *
 * Four assertions, all on the generated module that ships:
 *
 * 1. Drift: re-running `scripts/build-icons.mjs` in memory reproduces
 *    `src/ui/icons.generated.tsx` byte for byte. A stale generated file is how
 *    a new icon import silently renders nothing, so the file must be an
 *    artifact of the current usage scan.
 * 2. Coverage: every icon name imported anywhere in `src/` has an export in
 *    the generated file — the scanner and the emitter cannot disagree.
 * 3. Size: the module minifies to <= 60 KB, the §8 icon budget. Measured with
 *    esbuild's JS API (nothing written), frozen source, same minifier family
 *    Vite uses in the production build.
 * 4. The service worker never reaches the icon layer. Bundled with esbuild's
 *    metafile over the repo's own modules; a worker that imports
 *    `ui/icons` pays for React and every path it never draws.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateIcons,
  scanIconUsage,
  GENERATED_PATH,
  type GeneratedIcons,
} from '../../scripts/build-icons.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const swEntry = path.join(repoRoot, 'src', 'background', 'service-worker.ts');

/** docs/REDESIGN-V2.md §8 — Iconos: ≤ 60 KB. */
const ICON_BUDGET_BYTES = 60 * 1024;

const ICON_LAYER_INPUT = /\/src\/ui\/(icons|icons\.generated|icon-base)\.tsx?$/;

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

let generated: GeneratedIcons;
let onDisk: string;

beforeAll(async () => {
  generated = await generateIcons();
  onDisk = readFileSync(GENERATED_PATH, 'utf8').replace(/\r\n/g, '\n');
}, 120_000);

describe('icon generator: generated file is an artifact of current usage', () => {
  it('is up to date (no drift)', () => {
    const difference = generated.content === onDisk
      ? 'none'
      : 'generated content differs — run "pnpm icons:build"';
    expect(onDisk, difference).toBe(generated.content);
  });

  it('exports every icon imported anywhere in src', () => {
    const { imported } = scanIconUsage();
    const exported = new Set(generated.names);
    const missing = [...imported].filter((name) => !exported.has(name)).sort();
    expect(
      missing,
      `icons imported in src/ but absent from ${path.relative(repoRoot, GENERATED_PATH)}: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it(`stays under the ${kib(ICON_BUDGET_BYTES)} icon budget`, async () => {
    const result = await build({
      entryPoints: [GENERATED_PATH],
      bundle: true,
      minify: true,
      write: false,
      metafile: true,
      platform: 'neutral',
      format: 'esm',
      jsx: 'automatic',
      external: ['react'],
      logLevel: 'silent',
    });
    const output = result.outputFiles[0].contents.length;
    const over = output - ICON_BUDGET_BYTES;
    expect(
      output,
      `icons.generated.tsx minifies to ${kib(output)} (${output} bytes), ` +
        `${over > 0 ? `${kib(over)} OVER` : `${kib(-over)} under`} the §8 H7 ${kib(ICON_BUDGET_BYTES)} budget`,
    ).toBeLessThanOrEqual(ICON_BUDGET_BYTES);
  }, 60_000);

  it('is not reachable from the service worker bundle', async () => {
    const result = await build({
      entryPoints: [swEntry],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'neutral',
      format: 'esm',
      logLevel: 'silent',
      packages: 'external',
    });
    const inputs = Object.keys(result.metafile.inputs).map((key) => key.replace(/\\/g, '/'));
    // Self-check: an empty graph would pass the offender assertion vacuously.
    expect(
      inputs.some((key) => /\/shared\/i18n\/sw\.ts$/.test(key)),
      'esbuild resolved none of the worker sources — the metafile check is meaningless',
    ).toBe(true);
    const offenders = inputs.filter((key) => ICON_LAYER_INPUT.test(key));
    expect(
      offenders,
      `service worker graph includes ${offenders.join(', ')} — the worker must not pay for UI icons`,
    ).toEqual([]);
  }, 120_000);
});