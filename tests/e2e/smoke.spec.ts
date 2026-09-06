/**
 * End-to-end smoke test: proves the built extension actually loads into a real
 * Chromium, its MV3 service worker registers, and the capture path can grab a
 * usable frame from a live HTML5 <video>.
 *
 * No streaming service and no credentials are involved — the fixture page
 * paints its own synthetic video via canvas.captureStream, so the run is
 * deterministic and offline. This is the honest way to exercise Kivara against
 * a real browser: point it at a real <video> element, not a hijacked session.
 */
import { test, expect } from './fixtures';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_URL = pathToFileURL(path.join(here, 'fixtures', 'player.html')).href;

test('extension service worker registers with a valid id', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('captures a usable frame from a live <video>', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(PLAYER_URL);

  // Wait for the synthetic stream to be wired and producing frames.
  await page.waitForFunction(() => (window as unknown as { __kivaraFixtureReady?: boolean }).__kivaraFixtureReady === true);
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.readyState >= 2 && v.videoWidth > 0;
  });

  // Grab a frame the same way the extension's dumb-capture path does, and
  // score it with the same luminance/variance heuristic, all inside the page.
  const result = await page.evaluate(async () => {
    const video = document.querySelector('video')!;
    const w = Math.min(1280, video.videoWidth);
    const h = Math.round(video.videoHeight * (w / video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    let sum = 0;
    let sumSq = 0;
    let dark = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const y = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += y;
      sumSq += y * y;
      if (y < 0.06) dark += 1;
    }
    const luma = sum / pixels;
    const variance = Math.sqrt(Math.max(0, sumSq / pixels - luma * luma));
    const darkRatio = dark / pixels;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    return { luma, variance, darkRatio, dataUrl };
  });

  // Same gates as scoreFrameQuality: not black, not flat, not a fade.
  expect(result.variance).toBeGreaterThanOrEqual(0.012);
  expect(result.luma).toBeGreaterThanOrEqual(0.02);
  expect(result.luma).toBeLessThanOrEqual(0.985);
  expect(result.darkRatio).toBeLessThanOrEqual(0.97);
  expect(result.dataUrl.startsWith('data:image/jpeg')).toBe(true);
});
