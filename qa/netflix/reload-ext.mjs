import { chromium } from '@playwright/test';
const QA = process.env.KIVARA_QA_DIR ?? 'C:/Users/Kiva/AppData/Local/Temp/kivara-qa';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const bcdp = await browser.newBrowserCDPSession();
const install = await bcdp.send('Extensions.loadUnpacked', { path: QA + '/dist-open' }).catch((e) => ({ error: String(e) }));
console.log('install', JSON.stringify(install));
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => /\/watch\//.test(p.url())) ?? ctx.pages().find((p) => /netflix/.test(p.url()));
console.log('PAGE', page.url().slice(0, 60));
await page.reload({ waitUntil: 'commit', timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(14_000);
const st = await page.evaluate(() => {
  const v = document.querySelector('video');
  const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sid = vp?.getAllPlayerSessionIds?.()[0];
  const s = sid ? vp.getVideoPlayerBySessionId(sid) : null;
  const tracks = s?.getTimedTextTrackList?.() ?? [];
  const cur = s?.getTimedTextTrack?.();
  const host = document.getElementById('kivara-lingo-video-host');
  const plate = host?.shadowRoot?.querySelector('[data-kivara-caption-box]');
  return {
    video: v ? { paused: v.paused, t: Math.round(v.currentTime) } : null,
    current: cur ? { id: cur.trackId, lang: cur.bcp47 } : null,
    tracks: tracks.map((t) => `${t.bcp47}|${t.displayName}|forced=${t.isForcedNarrative}|${t.rawTrackType}`),
    host: !!host,
    caption: (plate?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
  };
});
console.log('AFTER-RELOAD', JSON.stringify(st, null, 1));
await browser.close().catch(() => {});
