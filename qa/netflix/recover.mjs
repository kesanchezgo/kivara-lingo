// Recover the playback session: full reload, profile pick, verify video+EME.
import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const page = ctx.pages().find((p) => /netflix\.com/.test(p.url())) ?? ctx.pages()[0];
const tile = page.locator('[data-uia^="profile-selector+tile-"]').filter({ hasText: /primos/i }).first();
for (let i = 0; i < 6 && (await tile.count()) > 0; i++) { await tile.click({ timeout: 5_000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 5_000)); }
await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 8_000));
for (let i = 0; i < 6 && (await tile.count()) > 0; i++) { await tile.click({ timeout: 5_000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 5_000)); }
await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 8_000));
for (let i = 0; i < 6 && (await tile.count()) > 0; i++) { await tile.click({ timeout: 5_000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 5_000)); }
await page.waitForFunction(() => !!document.querySelector('video'), { timeout: 45_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 8_000));
const st = await page.evaluate(() => {
  const v = document.querySelector('video');
  const err = document.body.innerText.match(/M73\d+/)?.[0] ?? null;
  const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sid = vp?.getAllPlayerSessionIds?.()[0];
  const s = sid ? vp.getVideoPlayerBySessionId(sid) : null;
  const c = s?.getTimedTextTrack?.();
  return {
    path: location.pathname, err,
    video: v ? { readyState: v.readyState, paused: v.paused, t: Math.round(v.currentTime), w: v.videoWidth } : null,
    track: c ? c.bcp47 : null,
    hosts: ['kivara-lingo-host', 'kivara-lingo-video-host'].map((id) => document.getElementById(id) ? 1 : 0),
  };
});
console.log('RECOVER', JSON.stringify(st));
await b.close().catch(() => {});
