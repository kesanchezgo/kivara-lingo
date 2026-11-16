// Part 2 — B6 only: re-enable subtitles through the player's menu (the row is
// "English (CC)", not "English") and watch the phrase come back.
//
//   node qa-part2-b6.mjs
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const QA = process.env.KIVARA_QA_DIR ?? 'C:/Users/Kiva/AppData/Local/Temp/kivara-qa';
const R = JSON.parse(fs.existsSync(QA + '/results.json') ? fs.readFileSync(QA + '/results.json', 'utf8') : '{}');
const record = (id, status, evidence, note = '') => {
  R[id] = { status, evidence, note, at: new Date().toISOString() };
  fs.writeFileSync(QA + '/results.json', JSON.stringify(R, null, 1));
  console.log(`[${id}] ${status} — ${String(evidence).slice(0, 300)}${note ? ' — ' + note : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => /\/watch\//.test(p.url()));
if (!page) { console.log('NO WATCH PAGE'); process.exit(1); }
await page.bringToFront().catch(() => {});
const consoleLines = [];
page.on('console', (m) => consoleLines.push(m.text()));

const tracks = () => page.evaluate(() => {
  const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sid = vp?.getAllPlayerSessionIds?.()[0];
  const s = sid ? vp.getVideoPlayerBySessionId(sid) : null;
  const cur = s?.getTimedTextTrack?.();
  return { current: cur ? { id: cur.trackId, bcp47: cur.bcp47, none: !!cur.isNoneTrack } : null };
});

const menuSwitch = async (startsWith) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.mouse.move(640, 400);
    await sleep(250);
    await page.mouse.move(660, 420);
    await sleep(500);
    const btn = await page.evaluate(() => {
      const el = document.querySelector('[data-uia="control-audio-subtitle"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    });
    if (!btn) continue;
    await page.mouse.click(btn.x, btn.y);
    await sleep(1_300);
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-uia^="subtitle-item-"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }));
    if (rows.length === 0) continue;
    const row = rows.find((r) => r.text.toLowerCase().startsWith(startsWith.toLowerCase()));
    if (!row) { await page.keyboard.press('Escape'); await sleep(500); continue; }
    await page.mouse.click(row.x, row.y);
    await sleep(1_500);
    return { clicked: true, text: row.text };
  }
  return { clicked: false, text: null };
};

const kivara = () => page.evaluate(() => {
  const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
  const pick = (sel) => (root?.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const notice = [...(root?.querySelectorAll('div,span,p') ?? [])]
    .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
    .find((t) => /subt[ií]tulos activos|no subtitles are active/i.test(t)) ?? '';
  return { caption: pick('[data-kivara-caption-box]'), notice, paused: document.querySelector('video')?.paused ?? null };
});

try {
  await page.evaluate(() => { const v = document.querySelector('video'); if (v?.paused) void v.play(); }).catch(() => {});
  await sleep(1_000);
  console.log('BEFORE', JSON.stringify(await tracks()));
  const on = await menuSwitch('English');
  await sleep(2_000);
  const st = await tracks();
  let phrase = '';
  for (let i = 0; i < 8 && !phrase; i++) { await sleep(2_000); phrase = (await kivara()).caption; }
  const afterOn = await kivara();
  record(
    'B6',
    phrase ? 'PASS' : 'FAIL',
    `al reactivar (clicked=${on.clicked}, fila="${on.text}", current=${JSON.stringify(st.current)}) → frase="${phrase.slice(0, 140)}"; aviso=${afterOn.notice ? 'presente' : 'retirado'}`,
    phrase ? '' : 'la frase no volvió',
  );
  const bad = consoleLines.filter((t) => /seek refused|player API did not answer|M7375|M7386/i.test(t));
  console.log('CONSOLE bad =', bad.length, bad.slice(0, 3));
  await page.screenshot({ path: QA + '/part2-b6.png' }).catch(() => {});
} catch (e) {
  console.log('ERROR', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  console.log('B6 DONE');
}
