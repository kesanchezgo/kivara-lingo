// Part 2 harness: the owner's protocol. Chrome stable opened BY HAND with the
// dedicated profile and --remote-debugging-port=9222; this script only
// attaches over CDP. Nothing here launches the browser, so no Playwright flag
// touches the Widevine path.
//
//   node qa-connect.mjs
//
// It then: loads the open-root copy of dist, reads chrome://components and the
// EME state, and prints a verdict. If Widevine plays, the pending cases run
// against the same session in the next script.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const QA = process.env.KIVARA_QA_DIR ?? path.join(os.tmpdir(), 'kivara-qa');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

const ctx = browser.contexts()[0] ?? (await browser.newContext());
console.log('contexts:', browser.contexts().length, 'pages:', ctx.pages().map((p) => p.url().slice(0, 50)));

// Load the extension from the open-root copy (test-only embed).
let install = null;
try {
  const bcdp = await browser.newBrowserCDPSession();
  install = await bcdp.send('Extensions.loadUnpacked', { path: QA + '/dist-open' });
} catch (e) {
  install = { error: String(e).split('\n')[0] };
}
console.log('install:', JSON.stringify(install));

// A tab for the checks, and the extension's service worker.
const page = ctx.pages().find((p) => /netflix\.com/.test(p.url())) ?? (await ctx.newPage());

const sw = await new Promise((resolve) => {
  const found = ctx.serviceWorkers().find((s) => s.url().includes('service-worker'));
  if (found) resolve(found);
  const timer = setTimeout(() => resolve(null), 8000);
  ctx.on('serviceworker', (s) => { clearTimeout(timer); resolve(s); });
});
console.log('service worker:', sw?.url() ?? 'none');
if (sw) {
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest()).catch(() => null);
  console.log('manifest:', manifest ? `${manifest.name} ${manifest.version}` : 'unreadable');
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ kivaraDebug: true });
    await chrome.storage.sync.set({ 'kivara-qa-probe': Date.now() });
  }).catch(() => {});
}

// chrome://components — is Widevine there, and at what version?
await page.goto('chrome://components', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(2500);
const components = await page.evaluate(() => {
  const out = [];
  const walk = (root, depth) => {
    if (!root || depth > 8) return;
    for (const el of root.querySelectorAll('*')) {
      const name = el.querySelector?.('#name')?.textContent ?? el.getAttribute?.('name') ?? '';
      if (/widevine/i.test(name ?? '')) {
        const version = el.querySelector?.('#version')?.textContent ?? el.getAttribute?.('version') ?? '';
        out.push({ name: name.trim(), version: version.trim() });
      }
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
  };
  walk(document, 0);
  const text = document.body.innerText.replace(/\s+/g, ' ');
  return { matches: out, hasWidevineText: /widevine/i.test(text), snippet: text.slice(0, 220) };
}).catch(() => ({ error: 'chrome://components unreadable' }));
console.log('COMPONENTS', JSON.stringify(components));

// EME state on a normal page (chrome:// pages cannot request a key system).
await page.goto('https://www.netflix.com/browse', { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(4000);
const eme = await page.evaluate(async () => {
  try {
    const a = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
      { initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] },
    ]);
    return `ok:${a.keySystem}`;
  } catch (e) {
    return `fail:${String(e).slice(0, 70)}`;
  }
});
console.log('EME', eme);

fs.writeFileSync(QA + '/connect-report.json', JSON.stringify({ install, components, eme, at: new Date().toISOString() }, null, 1));
await browser.close().catch(() => {});
console.log('CONNECT DONE');
