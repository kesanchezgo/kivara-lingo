/**
 * What a real production build puts in `dist/`.
 *
 * Two assertions live here, and they live in ONE file on purpose: both need to
 * read a fresh production build, and two suites each running their own `rm -rf
 * dist && vite build` clobber each other when Vitest runs files in parallel —
 * one ends up grepping the other's output, which is a build race masquerading
 * as a red test. One build, two sets of assertions, one suite.
 *
 * 1. The E2E bridge must never ship (see `src/e2e/index.html`): a production
 *    bundle containing the bridge page or the `KIVARA_E2E_` door would mean
 *    any page inside the extension could start tab capture or extract clips
 *    through a channel that checks nothing but sender identity.
 *
 * 2. The PCM worklet URL must name the chunk emitted in that same build. The
 *    worklet is a content-hashed build input that `audioWorklet.addModule`
 *    fetches, and the URL is injected by a vite plugin. Two silent failures:
 *    a leftover placeholder (URL that does not exist) and a URL naming a stale
 *    chunk (possible because `dist/` is not emptied between builds, so the old
 *    name usually still resolves and an older copy of the processor loads).
 *    `wirePcmCapture` swallows any `addModule` rejection and falls back to
 *    ScriptProcessor, which records fine — so the only honest check is on the
 *    artifacts.
 *
 * Cost: one build per Vitest run. Deliberate and bounded.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build as esbuildBuild } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist');

/**
 * Vite's CLI entry, executed by the Node binary running the tests.
 *
 * `npx` is not a dependency of this repo, so the suite must build without it.
 * `node_modules/.bin/vite` is a shell/cmd shim that `execFileSync` cannot run
 * portably on Windows, and `pnpm exec` would require the pnpm shim too — the
 * JS entry is the same CLI with no launcher in between.
 */
const VITE_BIN = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

const FORBIDDEN_TEXT = [
  // The bridge door: message types used only by the e2e listener.
  'KIVARA_E2E_START_AUDIO_CAPTURE',
  'KIVARA_E2E_EXTRACT_AUDIO_CLIP',
  // The synthetic-stream escape hatch in the offscreen recorder.
  'kivara-e2e-synthetic',
  // The canned health observations the parity screenshots seed.
  'KIVARA_E2E_SEED_HEALTH',
  // The canned Anki ping/answers the wizard walk uses.
  'kivara-e2e-anki',
  // The shadow-root handle the e2e suite clicks through. Attributes are the
  // only channel that crosses the content script's isolated world.
  'data-kivara-e2e-hits',
  'data-kivara-e2e-boxes',
  // The READ side of the same map: rail rows, translated lines, live regions
  // and the visible tab text, which carry no accessible name to click.
  'data-kivara-e2e-state',
  // Marks the corner icons for the geometry case. E2E build only: the markers
  // are written under `__E2E__`, so a production bundle that still contains
  // the name was not compiled with the constant.
  'data-kivara-badge',
];
const FORBIDDEN_PATHS = [/(^|\/)e2e\//];
/** What an un-rewritten worklet URL looks like in the bundle. */
const WORKLET_PLACEHOLDER = '/__PCM_WORKLET_URL__';

/**
 * Size budgets — docs/REDESIGN-V2.md §8, overrides §1.
 *
 * The doc measured main at v0.2.0 (content script 294 KB, SW 214 KB). This
 * tree is 0.3.0 and the UI layer has been ported, so the baselines below were
 * re-measured on the build produced by this working tree:
 *
 *   measured 2026-11-10, redesign/v2 (0.3.0), after the point-10 icon trim.
 *
 * Both numbers are the artifact's entry chunk plus every JS chunk it imports,
 * EXCLUDING the bundled dictionary chunk (2.1 MB, asserted on its own below).
 * The dictionary is excluded from both rows for the same reason the doc keeps
 * it separate: it is a data payload shared by the content script and the
 * worker, and letting it dominate either baseline turns the growth budget
 * into a rounding error. If a future feature legitimately grows the content
 * script or the worker by more than the row allows, raise the matching
 * BASELINE constant in the same commit as the feature — that edit is the
 * conscious budget decision this test exists to force.
 */
const CONTENT_SCRIPT_BASELINE_BYTES = 1_098_251;
const SERVICE_WORKER_BASELINE_BYTES = 393_980;

/** docs/REDESIGN-V2.md §8 — Content script (entrada + chunks de UI): ≤ +250 KB. */
const CONTENT_SCRIPT_GROWTH_BUDGET_BYTES = 250 * 1024;
/** docs/REDESIGN-V2.md §8 — SW: ≤ +40 KB (i18n del SW por separado). */
const SERVICE_WORKER_GROWTH_BUDGET_BYTES = 40 * 1024;
/** docs/REDESIGN-V2.md §8 — Iconos: ≤ 60 KB. */
const ICON_BUDGET_BYTES = 60 * 1024;
/** docs/REDESIGN-V2.md §8 — Fuente: ≤ 110 KB. */
const FONT_BUDGET_BYTES = 110 * 1024;

/** A chunk this large is the bundled dictionary, not UI code. */
const DICTIONARY_CHUNK_MIN_BYTES = 1024 * 1024;

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function relBytes(rel: string): number {
  return statSync(path.join(DIST, rel)).size;
}

function relText(rel: string): string {
  return readFileSync(path.join(DIST, rel), 'utf8');
}

/**
 * Resolve the chunk a crxjs loader points at. Content-script loaders use
 * `chrome.runtime.getURL('assets/...')`; the service-worker loader is a plain
 * side-effect import. Both are one indirection away from the real chunk.
 */
function loaderTarget(loaderRel: string): string {
  const text = relText(loaderRel);
  const raw =
    text.match(/chrome\.runtime\.getURL\("([^"]+)"\)/)?.[1] ??
    text.match(/import\s+'([^']+)'/)?.[1];
  if (!raw) throw new Error(`${loaderRel}: no chunk target found`);
  const clean = raw.replace(/^\.\//, '');
  return clean.startsWith('assets/') || clean.startsWith('src/') ? clean : `assets/${clean}`;
}

/** Static same-directory imports of one emitted JS chunk. */
function chunkImports(chunkRel: string): string[] {
  const text = relText(chunkRel);
  return [...text.matchAll(/(?:from|import)\s*"\.\/([^"]+)"/g)]
    .map((m) => `assets/${m[1]}`)
    .filter((rel) => rel.endsWith('.js'));
}

/** Entry chunk plus every chunk reachable through static imports. */
function chunkClosure(entryRel: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entryRel];
  while (stack.length > 0) {
    const rel = stack.pop() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const imported of chunkImports(rel)) stack.push(imported);
  }
  return seen;
}

function sumChunks(chunks: Iterable<string>): number {
  let total = 0;
  for (const rel of chunks) total += relBytes(rel);
  return total;
}

/** Budget assertion with a message naming the artifact, the budget and the overrun. */
function expectWithinBudget(label: string, measured: number, budget: number, row: string): void {
  const over = measured - budget;
  expect(
    measured,
    `${label} is ${kib(measured)} (${measured} bytes) — ` +
      `${over > 0 ? `${kib(over)} OVER` : `${kib(-over)} under`} its ${kib(budget)} ${row} budget`,
  ).toBeLessThanOrEqual(budget);
}

/**
 * Text of every non-binary file in `dist/`, mapped by relative path.
 */
function distFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const full = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, full);
        continue;
      }
      // Binary assets cannot contain the markers; minified text files can.
      if (/\.(png|csv|svg|woff2?|ttf|eot|ico)$/i.test(abs)) continue;
      out.push({ rel: full, text: readFileSync(abs, 'utf8') });
    }
  };
  walk(DIST, '');
  return out;
}

describe('a production build', () => {
  let files: Array<{ rel: string; text: string }>;
  let contentChunks: Set<string>;
  let swChunks: Set<string>;
  let dictionaryChunks: string[];

  beforeAll(() => {
    // Stash whatever is there: this asserts what the BUILD produces, not what
    // happened to be lying in the output folder beforehand.
    //
    // `KIVARA_SKIP_DIST_BUILD=1` keeps the folder as-is and just asserts. That
    // exists because the default WIPES `dist/`: harmless on CI and after an e2e
    // run, but it would replace the build you were about to zip for the store
    // when a stray `pnpm test` lands on it. Skipping is strictly weaker (it
    // cannot see a build that failed to produce), so it stays opt-in.
    if (process.env.KIVARA_SKIP_DIST_BUILD !== '1') {
      if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
      execFileSync(process.execPath, [VITE_BIN, 'build'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 180_000,
        // Vitest runs with NODE_ENV=test, and Vite then resolves React's
        // development CJS entry: the build is ~400 KB larger and the size
        // budgets would be measured on an artifact no user ever downloads.
        env: { ...process.env, NODE_ENV: 'production' },
      });
    }
    files = distFiles();

    // Chunk graph from the manifest, not from file names: a loader is the
    // manifest's entry, and the chunk it imports is what the browser executes.
    const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8')) as {
      content_scripts?: Array<{ js?: string[] }>;
      background?: { service_worker?: string };
    };
    const contentLoader = manifest.content_scripts?.[0]?.js?.[0];
    const swLoader = manifest.background?.service_worker;
    if (!contentLoader || !swLoader) throw new Error('manifest has no content script or worker');
    contentChunks = chunkClosure(loaderTarget(contentLoader));
    swChunks = chunkClosure(loaderTarget(swLoader));
    dictionaryChunks = [...contentChunks].filter(
      (rel) => relBytes(rel) > DICTIONARY_CHUNK_MIN_BYTES,
    );
  }, 240_000);

  it('produced a dist at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no e2e bridge page, door or synthetic-stream switch', () => {
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
  });

  it('left no un-rewritten worklet URL placeholder', () => {
    for (const { rel, text } of files) {
      expect(text.includes(WORKLET_PLACEHOLDER), `${rel} still contains ${WORKLET_PLACEHOLDER}`).toBe(false);
    }
  });

  it('points every worklet reference at the chunk this build emitted', () => {
    const onDisk = files
      .map((f) => f.rel.split('/').pop() ?? '')
      .filter((name) => /^pcm-worklet.*\.js$/.test(name));
    expect(onDisk, 'the build emitted no pcm-worklet chunk').toHaveLength(1);

    const references = files.flatMap(({ rel, text }) =>
      [...text.matchAll(/\/assets\/pcm-worklet[^"'\s]*\.js/g)].map((m) => ({ rel, url: m[0] })),
    );
    expect(references.length, 'no bundle referenced the worklet at all').toBeGreaterThan(0);

    for (const { rel, url } of references) {
      const name = url.slice(url.lastIndexOf('/') + 1);
      expect(
        onDisk.includes(name),
        `${rel} loads ${url}, which this build did not emit (it emitted ${onDisk.join(', ')})`,
      ).toBe(true);
    }
  });

  it('keeps WebAssembly compilable on extension pages', () => {
    // MV3's IMPLIED policy is `script-src 'self' 'wasm-unsafe-eval'`, so storing
    // that by hand is safe twice over: `WebAssembly.compile` on any page of the
    // extension keeps working. A hand-written `script-src 'self'` without the
    // token is not: compiling stops, and the only signal is an opaque thrown
    // error from inside the offscreen document — the page with the media graph
    // and therefore the likeliest first WASM consumer. The policy this
    // extension intends has never been compiled without the token, so it is
    // worth a test in the same place the rest of the dist-artifact guards live.
    const manifestPath = path.join(DIST, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const policy = (JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      content_security_policy?: { extension_pages?: string };
    }).content_security_policy?.extension_pages ?? '';
    expect(policy, 'the implied MV3 policy already forbids remote code').toContain(
      "'wasm-unsafe-eval'",
    );
    // `script-src 'self' 'wasm-unsafe-eval'` is exactly the parts of the default
    // that matter, plus the wasm token; anything wider is a relaxation.
    expect(policy).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
    // The exact comparison above IS the no-relaxation check: `'unsafe-eval'`
    // without the wasm token, a remote origin, or an inline `'unsafe-inline'`
    // would all read as a different string and fail there.
  });

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
    expect(JSON.stringify(manifest).toLowerCase()).not.toContain('kivara_e2e');
  });

  it('keeps the content script inside its §8 size budget', () => {
    const payload = [...contentChunks].filter((rel) => !dictionaryChunks.includes(rel));
    expectWithinBudget(
      'content script entry + its UI chunks (dictionary chunk excluded)',
      sumChunks(payload),
      CONTENT_SCRIPT_BASELINE_BYTES + CONTENT_SCRIPT_GROWTH_BUDGET_BYTES,
      '§8 content-script (baseline + 250 KB)',
    );
  });

  it('keeps the service worker inside its §8 size budget', () => {
    const payload = [...swChunks].filter((rel) => !dictionaryChunks.includes(rel));
    expectWithinBudget(
      'service worker entry + its chunks (dictionary chunk excluded)',
      sumChunks(payload),
      SERVICE_WORKER_BASELINE_BYTES + SERVICE_WORKER_GROWTH_BUDGET_BYTES,
      '§8 SW (baseline + 40 KB)',
    );
  });

  it('keeps the font bundle inside its §8 size budget', () => {
    const fontDir = path.join(DIST, 'src/assets/fonts');
    expect(existsSync(fontDir), 'dist/src/assets/fonts is missing').toBe(true);
    const fonts = readdirSync(fontDir).filter((name) => name.endsWith('.woff2')).sort();
    expect(fonts, `expected the two latin woff2 subsets, found ${fonts.join(', ') || 'none'}`).toHaveLength(2);
    const total = fonts.reduce((sum, name) => sum + statSync(path.join(fontDir, name)).size, 0);
    expectWithinBudget(
      `font bundle (${fonts.join(' + ')})`,
      total,
      FONT_BUDGET_BYTES,
      '§8 Fuente',
    );
  });

  it('keeps the icon payload inside its §8 size budget and actually ships it', async () => {
    const generatedPath = path.join(process.cwd(), 'src/ui/icons.generated.tsx');
    const generated = readFileSync(generatedPath, 'utf8');
    // Prove the build ships this exact payload: an icon path literal from the
    // generated module must survive minification in a content-script chunk.
    // A budget over a module the build does not include would guard nothing.
    const probe = [...generated.matchAll(/d: '([^']{100,})'/g)].map((m) => m[1])[0] ?? '';
    expect(probe.length, 'icons.generated.tsx has no long path literal to probe').toBeGreaterThan(0);
    const shipped = [...contentChunks]
      .filter((rel) => !dictionaryChunks.includes(rel))
      .some((rel) => relText(rel).includes(probe));
    expect(shipped, 'the trimmed icon payload is not present in any content-script chunk').toBe(true);

    const result = await esbuildBuild({
      entryPoints: [generatedPath],
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
    expectWithinBudget(
      'icon payload (icons.generated.tsx minified)',
      result.outputFiles[0].contents.length,
      ICON_BUDGET_BYTES,
      '§8 Iconos',
    );
  }, 60_000);

  it('emits the bundled dictionary as one deterministically named chunk', () => {
    // docs/REDESIGN-V2.md §1 flagged a 2 MB chunk rollup had named
    // `debug-log-*.js` because debug-log happened to be the first module in
    // it. The name is a build contract: a size audit can only diff this chunk
    // across builds if the name is derived from what the chunk IS.
    expect(
      dictionaryChunks,
      `expected exactly one >1 MB dictionary chunk, found: ${dictionaryChunks.join(', ') || 'none'}`,
    ).toHaveLength(1);
    const name = path.basename(dictionaryChunks[0]);
    expect(
      name,
      `the dictionary chunk is named ${name} — it must be named after the dictionary (yomitan-*.js), not an incidental first module`,
    ).toMatch(/^yomitan-[A-Za-z0-9_-]+\.js$/);
    expect(name, 'the audit saw this chunk named debug-log-*.js; that regression is back').not.toMatch(
      /^debug-log-/,
    );
  });

  it('exposes the fonts and frequency data through web_accessible_resources', () => {
    const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8')) as {
      web_accessible_resources?: Array<{ resources?: string[] }>;
    };
    const resources = (manifest.web_accessible_resources ?? []).flatMap(
      (entry) => entry.resources ?? [],
    );
    expect(
      resources.some((resource) => /(^|\/)src\/assets\/fonts\/\*$/.test(resource)),
      `web_accessible_resources does not expose src/assets/fonts/*: ${resources.join(', ')}`,
    ).toBe(true);
    expect(
      resources.some((resource) => /(^|\/)src\/assets\/frequency\/\*$/.test(resource)),
      `web_accessible_resources does not expose src/assets/frequency/*: ${resources.join(', ')}`,
    ).toBe(true);
  });
});
