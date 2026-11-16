// Part 2 rows, third pass — B1/B6 only. The menu needs a WAKE (mouse move so
// Netflix shows its control bar) and a REAL mouse click; the synthetic
// .click() on a hidden bar answered nothing.
//
//   node qa-part2-rows3.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const QA = process.env.KIVARA_QA_DIR ?? path.join(os.tmpdir(), 'kivara-qa');
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

const pickProfile = async () => {
  const tile = page.locator('[data-uia^="profile-selector+tile-"]').filter({ hasText: /primos/i }).first();
  for (let i = 0; i < 6 && (await tile.count()) > 0; i++) { await tile.click({ timeout: 5_000 }).catch(() => {}); await sleep(5_000); }
};

const tracks = () => page.evaluate(() => {
  const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sid = vp?.getAllPlayerSessionIds?.()[0];
  const s = sid ? vp.getVideoPlayerBySessionId(sid) : null;
  const list = s?.getTimedTextTrackList?.() ?? [];
  const cur = s?.getTimedTextTrack?.();
  return { ok: !!s, current: cur ? { id: cur.trackId, bcp47: cur.bcp47, none: !!cur.isNoneTrack } : null };
});

/** Wake the control bar, then open the subtitle menu with a REAL click. */
const menuSwitch = async (name) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    // Wake: move the pointer over the picture (NEVER click it — it pauses).
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
      return {
        uia: el.getAttribute('data-uia'),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
      };
    }));
    if (rows.length === 0) continue;
    console.log('MENU rows', JSON.stringify(rows.slice(0, 6)));
    const row = rows.find((r) => r.text.toLowerCase() === name.toLowerCase());
    if (!row) { await page.keyboard.press('Escape'); await sleep(500); continue; }
    await page.mouse.click(row.x, row.y);
    await sleep(1_500);
    return { clicked: true, rows: rows.length };
  }
  return { clicked: false, rows: 0 };
};

const kivara = () => page.evaluate(() => {
  const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
  const pick = (sel) => (root?.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const notice = [...(root?.querySelectorAll('div,span,p') ?? [])]
    .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
    .find((t) => /subt[ií]tulos activos|no subtitles are active/i.test(t)) ?? '';
  return { caption: pick('[data-kivara-caption-box]'), dual: pick('[data-kivara-dual]'), notice, paused: document.querySelector('video')?.paused ?? null };
});

const waitHosts = async () => {
  await page.waitForFunction(() => !!document.getElementById('kivara-lingo-video-host'), { timeout: 45_000 }).catch(() => {});
  await sleep(3_000);
};

try {
  await waitHosts();
  console.log('START', JSON.stringify(await tracks()));

  // ── B1: subtitles OFF through the player's own menu, then reload.
  const off = await menuSwitch('Off');
  await sleep(1_500);
  let st = await tracks();
  const offOk = st.current?.none === true || st.current === null;
  console.log('AFTER OFF', JSON.stringify({ clicked: off.clicked, current: st.current }));
  if (!offOk) {
    record('B1', 'FAIL', `el menú no dejó los subtítulos en Off (clicked=${off.clicked}): current=${JSON.stringify(st.current)}`);
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
    await sleep(6_000);
    await pickProfile();
    await waitHosts();
    await page.evaluate(() => { const v = document.querySelector('video'); if (v?.paused) void v.play(); }).catch(() => {});
    let noticeText = '';
    let capText = '';
    let cur = null;
    for (let i = 0; i < 10 && !noticeText; i++) {
      await sleep(2_000);
      const kv = await kivara();
      noticeText = kv.notice;
      capText = kv.caption;
      cur = await tracks();
    }
    record(
      'B1',
      noticeText ? 'PASS' : 'FAIL',
      `subtítulos off + recarga → aviso="${noticeText.slice(0, 140)}" (frase="${capText.slice(0, 50)}", current=${JSON.stringify(cur.current)})`,
      noticeText ? '' : 'sin aviso tras 20 s de reproducción',
    );

    // ── B6: re-enable through the menu → the phrase returns.
    const on = await menuSwitch('English');
    await sleep(2_000);
    st = await tracks();
    let phrase = '';
    for (let i = 0; i < 8 && !phrase; i++) { await sleep(2_000); phrase = (await kivara()).caption; }
    const afterOn = await kivara();
    record(
      'B6',
      phrase ? 'PASS' : 'FAIL',
      `al reactivar (clicked=${on.clicked}, current=${JSON.stringify(st.current)}) → frase="${phrase.slice(0, 140)}"; aviso=${afterOn.notice ? 'presente' : 'retirado'}`,
      phrase ? '' : 'la frase no volvió',
    );
  }
  const bad = consoleLines.filter((t) => /seek refused|player API did not answer|M7375|M7386/i.test(t));
  console.log('CONSOLE bad =', bad.length, bad.slice(0, 3));
  await page.screenshot({ path: QA + '/part2-rows3.png' }).catch(() => {});
} catch (e) {
  console.log('ERROR', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  console.log('ROWS3 DONE');
}
