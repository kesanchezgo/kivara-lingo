// Open the first "Stranger Things" result and report the tracks.
import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const page = ctx.pages().find((p) => /netflix\.com/.test(p.url())) ?? ctx.pages()[0];
const pickProfile = async () => {
  const tile = page.locator('[data-uia^="profile-selector+tile-"]').filter({ hasText: /primos/i }).first();
  for (let i = 0; i < 6 && (await tile.count()) > 0; i++) { await tile.click({ timeout: 5_000 }).catch(() => {}); await page.waitForTimeout(5_000); }
};

const at = page.locator('a[aria-label="Stranger Things"]').first();
await at.click({ timeout: 10_000 }).catch((e) => console.log('card click fail', String(e).slice(0, 60)));
await page.waitForTimeout(7_000);
await pickProfile();
await page.waitForTimeout(3_000);
console.log('URL', page.url().slice(0, 80));
const play = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-uia="play-button"], [data-uia="play-video-button"]')].find((x) => x.getBoundingClientRect().width > 0);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
console.log('PLAY', JSON.stringify(play));
if (play) await page.mouse.click(play.x, play.y);
await page.waitForFunction(() => !!document.querySelector('video'), { timeout: 40_000 }).catch(() => null);
await page.waitForTimeout(7_000);
const st = await page.evaluate(() => {
  const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sid = vp?.getAllPlayerSessionIds?.()[0];
  const s = sid ? vp.getVideoPlayerBySessionId(sid) : null;
  const tracks = s?.getTimedTextTrackList?.() ?? [];
  const cur = s?.getTimedTextTrack?.();
  const v = document.querySelector('video');
  return {
    path: location.pathname, video: v ? { paused: v.paused, t: Math.round(v.currentTime), w: v.videoWidth } : null,
    current: cur ? { id: cur.trackId, bcp47: cur.bcp47 } : null,
    hasEn: tracks.some((t) => /^en/i.test(t.bcp47 ?? '')),
    tracks: tracks.map((t) => `${t.bcp47}|${t.displayName}|none=${!!t.isNoneTrack}|${t.rawTrackType}`),
  };
});
console.log('WATCH', JSON.stringify(st, null, 1));
await b.close().catch(() => {});
