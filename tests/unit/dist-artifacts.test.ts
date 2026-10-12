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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist');

const FORBIDDEN_TEXT = [
  // The bridge door: message types used only by the e2e listener.
  'KIVARA_E2E_START_AUDIO_CAPTURE',
  'KIVARA_E2E_EXTRACT_AUDIO_CLIP',
  // The synthetic-stream escape hatch in the offscreen recorder.
  'kivara-e2e-synthetic',
];
const FORBIDDEN_PATHS = [/(^|\/)e2e\//];
/** What an un-rewritten worklet URL looks like in the bundle. */
const WORKLET_PLACEHOLDER = '/__PCM_WORKLET_URL__';

/** Text of every non-binary file in `dist/`, mapped by relative path. */
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

  beforeAll(() => {
    // Stash whatever is there: this asserts what the BUILD produces, not what
    // happened to be lying in the output folder beforehand.
    if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
    execFileSync('npx', ['vite', 'build'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 180_000,
    });
    files = distFiles();
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
    // error from inside the offscreen document — the same page that loads
    // Whisper's WASM. The policy this extension intends has never been
    // compiled without it, so it is worth a test in the same place the rest of
    // the dist-artifact guards live.
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
});
