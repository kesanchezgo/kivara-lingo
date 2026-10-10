import { expect, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from './fixtures';

/**
 * Redirect probe.
 *
 * A URL guard that validates the request and then fetches only holds if a
 * `302` on the FIRST url is visible to us. With `redirect: 'manual'` the Fetch
 * spec returns an OPAQUE REDIRECT (`status: 0`, no headers), so `Location`
 * cannot be read, the guard sees `HTTP 0`, and every https-upgrade / www /
 * CDN / GitHub-releases hop in the dictionary chain dies. This test pins the
 * browser behaviour so the guard cannot be written that way again: whatever
 * Chromium does, `follow` must deliver the final URL and body.
 */
interface ProbeResult {
  manualStatus: number;
  manualType: string;
  manualLocation: string | null;
  followStatus: number;
  followUrl: string;
  followBody: string;
}

async function probeRedirects(page: Page, from: string): Promise<ProbeResult> {
  return await page.evaluate(async (url: string) => {
    const manual = (await fetch(url, { redirect: 'manual' })) as Response;
    const follow = await fetch(url, { redirect: 'follow' });
    return {
      manualStatus: manual.status,
      manualType: manual.type ?? 'unknown',
      manualLocation: manual.headers.get('location'),
      followStatus: follow.status,
      followUrl: follow.url,
      followBody: (await follow.text()).trim(),
    } satisfies ProbeResult;
  }, from);
}

test('redirect semantics from the extension origin (guards depend on this)', async ({
  context,
  extensionId,
}) => {
  const target = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('arrived');
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));

  let redirectTarget = '';
  const redirects = http.createServer((_req, res) => {
    res.writeHead(302, { location: redirectTarget });
    res.end();
  });
  await new Promise<void>((r) => redirects.listen(0, '127.0.0.1', r));

  try {
    const targetPort = (target.address() as AddressInfo).port;
    const redirectPort = (redirects.address() as AddressInfo).port;
    redirectTarget = `http://127.0.0.1:${targetPort}/ok`;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    const probe = await probeRedirects(page, `http://127.0.0.1:${redirectPort}/start`);

    // What `redirect: 'follow'` gives the guard: the final URL and the body.
    expect(probe.followStatus).toBe(200);
    expect(probe.followUrl).toBe(redirectTarget);
    expect(probe.followBody).toBe('arrived');

    // What `redirect: 'manual'` gives: an opaque redirect with no headers to
    // read. When that is true (it is, in Chromium) any guard written around
    // 'manual' silently breaks every redirect.
    console.info(
      `[redirect-probe] manual status=${probe.manualStatus} type=${probe.manualType} location=${probe.manualLocation}`,
    );
    if (probe.manualStatus === 0 || probe.manualType === 'opaqueredirect') {
      expect(probe.manualLocation).toBeNull();
      expect(probe.manualStatus).toBe(0);
    }
  } finally {
    await new Promise<void>((r) => target.close(() => r()));
    await new Promise<void>((r) => redirects.close(() => r()));
  }
});
