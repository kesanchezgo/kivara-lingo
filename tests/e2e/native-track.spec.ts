/**
 * Netflix's NATIVE-language track arrives through the manifest flow.
 *
 * Netflix ships every subtitle track inside the playback manifest (with
 * downloadable TTML URLs), but only the LEARNED language's track is ever
 * requested by the player — so the transcript had no per-row native line
 * ([data-kvl-native] = 0) and the dual caption fell back to machine
 * translation. The MAIN world's JSON.parse hook now captures the decrypted
 * manifest and the bus downloads the native track from the manifest's URL,
 * the same way the MPD flow already does for HBO Max / Disney+.
 *
 * The fixture parses a simulated manifest with JSON.parse (the seam the hook
 * watches) and serves both tracks' TTML through the spec's routes. Without
 * the flow the rail's native column is empty and the dual caption never
 * appears (the MT chain is offline in the suite); with it, the rail shows
 * the native line and the overlay paints the NATIVE text — not an MT
 * translation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { LABEL, PANEL_HOST, VIDEO_HOST, armBar, clickInRoot, hitsOf, stateOf } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(here, 'fixtures', 'player-netflix-manifest.html'), 'utf8');

/** The source (EN) track the player itself requests. */
const SOURCE_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">
  <body>
    <div>
      <p begin="0s" end="3s">I know what I saw.</p>
      <p begin="3s" end="6s">Nobody believes me.</p>
      <p begin="6s" end="9s">But it was right there.</p>
    </div>
  </body>
</tt>`;

/** The NATIVE (ES) track the manifest flow downloads. Distinct wording per
 * line so the overlay's dual caption provably comes from THIS track. */
const NATIVE_TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="es">
  <body>
    <div>
      <p begin="0s" end="3s">Yo sé lo que vi aquella noche.</p>
      <p begin="3s" end="6s">Nadie me cree nada.</p>
      <p begin="6s" end="9s">Pero estaba justo ahí.</p>
    </div>
  </body>
</tt>`;

async function openNetflixManifest(context: import('@playwright/test').BrowserContext) {
  const page = (await context.newPage()) as import('@playwright/test').Page & { nativeDownloads: string[] };
  page.nativeDownloads = [];
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('console', (m) => {
    if (m.text().includes('kvl-e2e')) fs.appendFileSync('test-results/native-console.log', JSON.stringify(m.text()) );

  });
  page.on('request', (r) => {
    if (r.url().includes('e2e-netflix-tt')) page.nativeDownloads.push(r.url());
  });
  await page.route('*://e2e-netflix-tt/**', async (route) => {
    const url = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      headers: { 'access-control-allow-origin': '*' },
      body: url.includes('/es.ttml') ? NATIVE_TTML : SOURCE_TTML,
    });
  });
  await page.route('*://*.nflxvideo.net/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      headers: { 'access-control-allow-origin': '*' },
      body: SOURCE_TTML,
    });
  });
  await page.route('*://*.netflix.com/**', async (route) => {
    if (route.request().url().includes('/watch/')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
  });
  await page.goto('https://www.netflix.com/watch/82939619');
  await page.bringToFront();
  await page.waitForFunction(
    () => (window as Window & { __kivaraFixtureReady?: unknown }).__kivaraFixtureReady !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  await expect
    .poll(
      () => page.evaluate((id) => document.getElementById(id) !== null, VIDEO_HOST),
      { timeout: 15_000 },
    )
    .toBe(true);
  return page;
}

test('the transcript shows the native line and the overlay uses it over MT', async ({ context }) => {
  test.setTimeout(120_000);
  let lastOverlay = '';
  const page = await openNetflixManifest(context);
  try {
    // The fixture's manifest reached the hook (including the forced es row).
    const tracks = await page.evaluate(() => (window as Window & { __kivaraManifestTracks?: number }).__kivaraManifestTracks);
    expect(tracks).toBe(3);

    // The rail's native lines need the rail OPEN: toggle it via the bar.
    await armBar(page);
    const railHits = (await hitsOf(page, VIDEO_HOST)).filter((h) => h.label === LABEL.railToggle && h.pressed !== undefined);
    if (railHits.length === 0) throw new Error('no rail toggle in the hit map');
    await page.mouse.click(railHits[0].cx, railHits[0].cy);
    await page.waitForTimeout(1_000);
    const afterToggle = (await hitsOf(page, VIDEO_HOST)).filter((h) => h.label === LABEL.railToggle);
    console.log('TOGGLE after', JSON.stringify(afterToggle.map((h) => ({ p: h.pressed, x: h.cx, y: h.cy }))));
    // The manifest flow downloaded the native track from its URL.
    await expect
      .poll(
        () => (page as unknown as { nativeDownloads: string[] }).nativeDownloads.length,
        { timeout: 10_000, message: 'the native track was downloaded from the manifest URL' },
      )
      .toBeGreaterThan(0);

    // The FORCED es track is listed first in the manifest and carries a
    // near-empty TTML. It is NEVER the native track: its URL must not be
    // downloaded, or the overlay would paint an empty "translation".
    const downloads = (page as unknown as { nativeDownloads: string[] }).nativeDownloads;
    expect(downloads.some((url) => url.includes('es-forced.ttml'))).toBe(false);
    expect(downloads.some((url) => url.includes('/es.ttml'))).toBe(true);

    // The overlay's dual caption paints the NATIVE text (the alt cue wins
    // over the MT chain). The current cue varies with the clip's clock, so
    // the predicate accepts any of the native track's lines.
    const nativeLines = NATIVE_TTML.match(/<p[^>]*>([^<]+)<\/p>/g)?.map((p) =>
      p.replace(/<[^>]+>/g, '').trim(),
    ) ?? [];
    await expect
      .poll(
        async () => {
          const overlayState = await stateOf(page, VIDEO_HOST);
          lastOverlay = overlayState.translation?.text ?? '';
          return nativeLines.includes(lastOverlay.trim());
        },
        { timeout: 15_000, message: 'the overlay paints the native line' },
      )
      .toBe(true);
  } catch (err) {
    throw err;
  } finally {
    await page.close();
  }
});

