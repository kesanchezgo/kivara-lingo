/**
 * The two behaviours a manual Chrome check used to cover, now automated.
 *
 * Both are properties of the *shipped build running in a real renderer*, so
 * neither belongs in a unit test: one is a CSP verdict (whether a page of the
 * extension may compile a WebAssembly module at all) and the other is which
 * capture route a real `AudioContext` picks when nobody forces one.
 *
 *  1. Offscreen WASM. `manifest.json` declares `script-src 'self'
 *     'wasm-unsafe-eval'`. The manifest guard in `tests/unit/dist-artifacts.test.ts`
 *     reads the string; this runs a COMPILE. The distinction matters: the
 *     manifest can carry the token while the page that ships is not the one the
 *     policy was written for.
 *
 *  2. The default capture path. `PCM_WORKLET_DEFAULT = true` means an unforced
 *     run should land on the AudioWorklet route. Forcing the path is what the
 *     smoke does, so the default itself had no coverage: a regression that
 *     flipped the constant, or a probe that started failing, would pass every
 *     forced run.
 *
 * Needs a KIVARA_E2E build for #2 only (the bridge door lives there); #1 works
 * against a production dist too.
 */
import { test, expect } from './fixtures';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Minimal valid wasm module: magic + version, nothing else. */
const EMPTY_WASM_MODULE = [0, 97, 115, 109, 1, 0, 0, 0];

function hasE2EBridge(dist: string): boolean {
  return existsSync(path.join(dist, 'src', 'e2e', 'index.html'));
}

test.describe('shipped-build capabilities', () => {
  test('the offscreen page can compile a WebAssembly module', async ({ context, extensionId }) => {
    test.setTimeout(60_000);
    // Opened as a tab, not created: `chrome.offscreen.createDocument` refuses a
    // document whose URL already answers, and this run must not disturb the
    // capture path the other tests drive.
    const offscreen = await context.newPage();
    const errors: string[] = [];
    offscreen.on('pageerror', (err) => errors.push(String(err)));
    await offscreen.goto(`chrome-extension://${extensionId}/src/offscreen/index.html`);
    // The page's own module has to have reached its first statement for this to
    // be a verdict about the page and not just an empty document.
    await offscreen.waitForFunction(() => document.readyState === 'complete');

    const compiled = await offscreen.evaluate(
      async (bytes: number[]) => {
        const Wasm = WebAssembly;
        try {
          const module = await Wasm.compile(new Uint8Array(bytes));
          return { ok: module instanceof WebAssembly.Module, error: null };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
      EMPTY_WASM_MODULE,
    );
    expect(errors, 'the offscreen page threw during load').toEqual([]);
    expect(compiled, 'WebAssembly.compile was refused on an extension page').toMatchObject({
      ok: true,
      error: null,
    });
    await offscreen.close();
  });

  test.describe('capture defaults', () => {
    test.skip(
      () => !hasE2EBridge(path.resolve(here, '../../dist')),
      'skipped: the capture default needs a KIVARA_E2E=1 build to drive the status door',
    );

    test('an unforced run auto-detects the AudioWorklet path', async ({ context, extensionId }) => {
      test.setTimeout(180_000);
      const bridgePage = await context.newPage();
      await bridgePage.goto(`chrome-extension://${extensionId}/src/e2e/index.html`);
      await bridgePage.waitForFunction(() => document.readyState === 'complete');

      const start = await bridgePage.evaluate(async () => {
        const api = (globalThis as unknown as { chrome: typeof chrome }).chrome;
        return await new Promise((resolve, reject) => {
          api.runtime.sendMessage(
            { type: 'KIVARA_E2E_START_AUDIO_CAPTURE', data: { synthetic: true } },
            (response) => {
              if (api.runtime.lastError) {
                reject(new Error(api.runtime.lastError.message));
                return;
              }
              resolve(response as object);
            },
          );
        });
      });
      expect(start, `capture refused: ${JSON.stringify(start)}`).toMatchObject({ ok: true });

      // Poll the diagnostic: `addModule` is async, so the very first read can
      // legitimately still show the fallback while the probe is in flight.
      // `PCM_WORKLET_DEFAULT = true` is what makes the settled value
      // 'audio-worklet'; a run that never leaves 'script-processor' means the
      // default or the probe is broken, and that is the assertion that matters.
      let pcmPath: string | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const status = (await bridgePage.evaluate(async () => {
          const api = (globalThis as unknown as { chrome: typeof chrome }).chrome;
          return await new Promise((resolve) => {
            api.runtime.sendMessage({ type: 'KIVARA_E2E_AUDIO_CAPTURE_STATUS' }, (response) => {
              resolve(response as object);
            });
          });
        })) as { pcmPath?: string | null; active?: boolean };
        pcmPath = status.pcmPath ?? null;
        if (pcmPath === 'audio-worklet') break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(pcmPath, 'the probe never settled on the worklet path').toBe('audio-worklet');

      await bridgePage.close();
    });
  });
});
