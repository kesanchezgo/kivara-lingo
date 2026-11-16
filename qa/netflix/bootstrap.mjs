import { chromium } from '@playwright/test';
const QA = process.env.KIVARA_QA_DIR ?? 'C:/Users/Kiva/AppData/Local/Temp/kivara-qa';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const bcdp = await browser.newBrowserCDPSession();
console.log('install', JSON.stringify(await bcdp.send('Extensions.loadUnpacked', { path: QA + '/dist-open' }).catch((e) => ({ error: String(e).slice(0, 80) }))));
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.netflix.com/browse', { waitUntil: 'commit', timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(12_000);
await page.evaluate(() => document.querySelector('[data-uia^="profile-selector+tile-"]')?.click()).catch(() => {});
await page.waitForTimeout(8_000);
const st = await page.evaluate(() => ({ url: location.pathname, body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 60) }));
console.log('BROWSE', JSON.stringify(st));
const play = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-uia="play-video-button"]')]
    .map((x) => { const r = x.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), vis: r.width > 0 }; })
    .find((x) => x.vis);
  return b ?? null;
});
console.log('PLAY', JSON.stringify(play));
if (play) await page.mouse.click(play.x, play.y);
await page.waitForTimeout(12_000);
const w = ctx.pages().find((p) => p.url().includes('/watch/')) ?? page;
await w.waitForFunction(() => !!document.getElementById('kivara-lingo-video-host'), { timeout: 40_000 }).catch(() => {});
const q = await w.evaluate(() => {
  const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sid = vp?.getAllPlayerSessionIds?.()[0];
  const s = sid ? vp.getVideoPlayerBySessionId(sid) : null;
  const v = document.querySelector('video');
  const plate = document.getElementById('kivara-lingo-video-host')?.shadowRoot?.querySelector('[data-kivara-caption-box]');
  return {
    url: location.pathname,
    t: v ? Math.round(v.currentTime) : null,
    track: s?.getTimedTextTrack?.()?.bcp47 ?? null,
    hosts: ['kivara-lingo-host', 'kivara-lingo-video-host'].map((id) => document.querySelectorAll(`#${id}`).length),
    caption: (plate?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
  };
});
console.log('WATCH', JSON.stringify(q));
await browser.close().catch(() => {});
