/**
 * Gate: the service worker bundle must stay free of UI weight.
 *
 * Bundles src/background/service-worker.ts with esbuild's JS API (virtual,
 * nothing written) and inspects the metafile's module graph. Two things must
 * never appear in the worker graph:
 *
 * 1. `shared/i18n/index` — the UI i18n barrel. It merges all ~1300 keys AND
 *    imports `useSyncExternalStore` from 'react'. Background/content-worker
 *    modules import `t` from `shared/i18n/sw` (the worker subset) instead.
 *    WHAT BREAKS THE FIRST ASSERTION: any SW-graph module re-adding
 *    `import { t } from '.../shared/i18n'` — exactly what
 *    src/content/nlp/yomitan.ts used to do before this gate existed.
 *
 * 2. `react` (react/index.js, react/cjs, node_modules/react/). React reaches
 *    the worker graph without any i18n involvement whenever a module the SW
 *    imports pulls React at module scope. WHAT BREAKS THE SECOND ASSERTION:
 *    a module-scope `import ... from 'react'` in anything the worker reaches
 *    (src/shared/host-permissions-store.ts used to do this), or zustand's
 *    React-bound root import in shared/store.ts (`create` from 'zustand' —
 *    the store therefore uses `createStore` from 'zustand/vanilla', and the
 *    hook lives in shared/use-kivara-store.ts, which the SW never imports).
 *
 * The esbuild run takes seconds (it spawns the binary and bundles ~120
 * modules), so the hook carries a generous timeout.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const repoRequire = createRequire(path.join(repoRoot, 'package.json'));
const swEntry = path.join(repoRoot, 'src', 'background', 'service-worker.ts');

// esbuild (0.25.x) cannot resolve webextension-polyfill — a dependency OF
// webext-bridge — through pnpm's Windows junction chain, while node and rollup
// (the real vite build) both resolve it fine. Resolution must stay REAL so the
// metafile shows what the worker actually carries, so we resolve the polyfill
// the way node does (through webext-bridge's own dependency) and hand esbuild
// the concrete file via `alias`. No module is marked `external`: everything
// else — webext-bridge itself, dexie, fflate — bundles normally.
const wmbBackgroundJs = repoRequire.resolve('webext-bridge/background');
const wmbRequire = createRequire(wmbBackgroundJs);
const webextensionPolyfillJs = wmbRequire.resolve('webextension-polyfill/dist/browser-polyfill.js');

let inputs: string[];

/** esbuild metafile keys use forward slashes; normalize defensively anyway. */
function normalizedInputs(): string[] {
  return inputs.map((k) => k.replace(/\\/g, '/'));
}

beforeAll(async () => {
  const result = await build({
    entryPoints: [swEntry],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'neutral',
    format: 'esm',
    logLevel: 'silent',
    alias: { 'webextension-polyfill': webextensionPolyfillJs },
  });
  inputs = Object.keys(result.metafile.inputs);
}, 120_000);

describe('service worker bundle: i18n and React stay out', () => {
  it('metafile actually sees our modules (self-check)', () => {
    // Proves the build resolved the repo's own sources at all — without this,
    // a build that silently produced an empty graph would pass both gates.
    const seen = normalizedInputs().some((k) => /\/shared\/i18n\/sw\.ts$/.test(k));
    expect(seen).toBe(true);
  });

  it('does not include the UI i18n barrel (shared/i18n/index)', () => {
    const offenders = normalizedInputs().filter((k) => k.includes('/shared/i18n/index'));
    expect(offenders).toEqual([]);
  });

  it('does not include react', () => {
    // Matches node_modules/react/ at any depth (top-level or pnpm store),
    // which covers react/index.js and react/cjs/* in one sweep.
    const offenders = normalizedInputs().filter((k) => /\/node_modules\/react\//.test(k));
    expect(offenders).toEqual([]);
  });
});
