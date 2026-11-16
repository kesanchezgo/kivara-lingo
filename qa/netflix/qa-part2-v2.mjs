// Part 2 QA v2 — corrected methods.
//
//   node qa-part2-v2.mjs
//
// D4/E2/E3: pause, hook `seeked`, act, compare `__seekedAt` with the EXACT cue
// start (ms) taken from the TTML Kivara itself read — not the mm:ss label.
// B3: per-change delta measured in VIDEO time, annotating whether the cue
// overlaps the previous one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const QA = process.env.KIVARA_QA_DIR ?? path.join(os.tmpdir(), 'kivara-qa');
const R = JSON.parse(fs.existsSync(QA + '/results.json') ? fs.readFileSync(QA + '/results.json', 'utf8') : '{}');
const record = (id, status, evidence, note = '') => {
  R[id] = { status, evidence, note, at: new Date().toISOString() };
  fs.writeFileSync(QA + '/results.json', JSON.stringify(R, null, 1));
  console.log(`[${id}] ${status} — ${String(evidence).slice(0, 240)}${note ? ' — ' + note : ''}`);
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('/watch/')) ?? ctx.pages().find((p) => /netflix/.test(p.url()));
await page.bringToFront().catch(() => {});
const consoleLines = [];
page.on('console', (m) => consoleLines.push(m.text()));
const consoleBad = () => consoleLines.some((t) => /seek refused|player API did not answer|M7375/i.test(t));

const S = (p) => p.evaluate(() => {
  const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
  const panel = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
  const v = document.querySelector('video');
  return {
    t: v ? Math.round(v.currentTime * 1000) / 1000 : null,
    paused: v ? v.paused : null,
    railOpen: !!panel?.querySelector('[role="tabpanel"]'),
    rows: [...(panel?.querySelectorAll('[data-kvl-cue]') ?? [])].map((n) => ({
      index: Number(n.getAttribute('data-kvl-cue')),
      start: Number(n.getAttribute('data-kvl-start')),
      text: (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
    seekedAt: window.__seekedAt ?? null,
    caption: (root?.querySelector('[data-kivara-caption-box]')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
  };
});

/** The cue starts (ms) from the TTML the page itself loaded. */
const cueStarts = (p) => p.evaluate(async () => {
  const urls = performance.getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => /nflxvideo\.net/.test(u) && /\.(xml|ttml|dfxp)/i.test(u));
  for (const url of urls) {
    try {
      const body = await (await fetch(url)).text();
      if (!/<tt[\s>]/i.test(body)) continue;
      const starts = [];
      for (const m of body.matchAll(/<p\b[^>]*begin\s*=\s*"([^"]+)"/g)) {
        const raw = m[1];
        const sec = Number(raw.replace(/s$/, ''));
        if (Number.isFinite(sec)) starts.push(Math.round(sec * 1000));
      }
      if (starts.length) return { url: url.slice(0, 60), starts };
    } catch { /* next */ }
  }
  return null;
});

const wake = async (p) => { await p.mouse.move(700, 420); await p.waitForTimeout(250); await p.mouse.move(716, 436); await p.waitForTimeout(420); };
const barVisible = (p) => p.evaluate(() => {
  const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
  const bar = root?.querySelector('[role="toolbar"]');
  return !!bar && getComputedStyle(bar).opacity === '1';
});
const press = async (p, re) => {
  for (let i = 0; i < 4 && !(await barVisible(p)); i++) await wake(p);
  const box = await p.evaluate((src) => {
    const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
    const r2 = new RegExp(src, 'i');
    const el = [...(root?.querySelectorAll('button, [role="button"]') ?? [])].find((b) => {
      const all = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''} ${(b.textContent ?? '').trim()}`;
      return r2.test(all.trim());
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el.textContent ?? '').trim() };
  }, re);
  if (!box) return null;
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(300);
  return box;
};
const ensureRail = async (p, want) => {
  if ((await S(p)).railOpen === want) return true;
  await wake(p);
  const b = await p.evaluate(() => {
    const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
    const el = [...(root?.querySelectorAll('button[aria-label]') ?? [])].find((x) => /transcrip/i.test(x.getAttribute('aria-label') ?? ''));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!b) return false;
  await p.mouse.click(b.x, b.y);
  await p.waitForTimeout(2_000);
  return (await S(p)).railOpen === want;
};
const selectLinesTab = async (p) => {
  const tab = await p.evaluate(() => {
    const panel = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
    const el = [...(panel?.querySelectorAll('[role="tab"]') ?? [])].find((x) => /^(lines|frases)$/i.test((x.textContent ?? '').trim()));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (tab) await p.mouse.click(tab.x, tab.y);
  await p.waitForTimeout(1_500);
  return !!tab;
};
const hookSeek = (p) => p.evaluate(() => {
  window.__seekedAt = null;
  const v = document.querySelector('video');
  if (!v) return;
  v.addEventListener('seeked', () => { window.__seekedAt = Math.round(v.currentTime * 1000) / 1000; }, { once: true });
});
const pause = (p) => p.evaluate(() => document.querySelector('video')?.pause());

await page.waitForFunction(() => !!document.getElementById('kivara-lingo-video-host'), { timeout: 40_000 }).catch(() => {});
const base = await S(page);
console.log('PAGE', page.url().slice(0, 40), JSON.stringify({ t: base.t, paused: base.paused, caption: base.caption }).slice(0, 160));

const cueInfo = await cueStarts(page);
console.log('TTML', cueInfo ? `${cueInfo.starts.length} frases` : 'no disponible');

// ── D4 / E2 / E3 ─────────────────────────────────────────────────────────
try {
  await ensureRail(page, true);
  await selectLinesTab(page);
  const rows = (await S(page)).rows;
  if (rows.length < 5 || !rows.every((r) => Number.isFinite(r.start))) {
    for (const id of ['D4', 'E2', 'E3']) record(id, 'NO PROBADO', `sin datos: filas=${rows.length}`);
  } else {
    // Kivara's OWN cue starts, in ms (data-kvl-start) — not the mm:ss label.
    const starts = rows.map((r) => r.start);
    const rowsWithStart = rows;
    const startOf = (row) => row.start;

    // D4 — click a row near the playhead, paused.
    await pause(page);
    await page.waitForTimeout(400);
    const here = (await S(page)).t * 1000;
    const target = rowsWithStart.find((r) => startOf(r) > here + 8_000) ?? rowsWithStart[Math.floor(rowsWithStart.length / 2)];
    await page.evaluate((index) => {
      const panel = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
      const row = panel?.querySelector(`[data-kvl-cue="${index}"]`);
      row?.scrollIntoView({ block: 'center' });
    }, target.index);
    await page.waitForTimeout(500);
    await hookSeek(page);
    const box = await page.evaluate((index) => {
      const panel = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
      const row = panel?.querySelector(`[data-kvl-cue="${index}"]`);
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, target.index);
    if (box) await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1_500);
    let s = await S(page);
    if (s.seekedAt === null) {
      await page.evaluate((index) => {
        const panel = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        panel?.querySelector(`[data-kvl-cue="${index}"]`)?.click();
      }, target.index);
      await page.waitForTimeout(1_200);
      s = await S(page);
    }
    const d4 = s.seekedAt !== null ? Math.abs(s.seekedAt - startOf(target) / 1000) : null;
    record('D4', d4 !== null && d4 <= 0.5 && !consoleBad() ? 'PASS' : 'FAIL',
      `fila #${target.index} "${target.text.slice(0, 24)}"; seekedAt=${s.seekedAt}s, inicio exacto=${(startOf(target) / 1000).toFixed(3)}s, |Δ|=${d4 === null ? 'n/a' : d4.toFixed(3)}s; consola seek=${consoleBad()}`);

    // E2 — Siguiente: the next cue's exact start.
    await pause(page);
    await page.waitForTimeout(300);
    const now2 = (await S(page)).t * 1000;
    const activeIdx = starts.reduce((best, st, i) => (st <= now2 + 50 && i > best ? i : best), 0);
    await hookSeek(page);
    await press(page, 'next|siguiente');
    await page.waitForTimeout(1_500);
    let s2 = await S(page);
    const expectedNext = starts[activeIdx + 1] ?? null;
    const d2 = s2.seekedAt !== null && expectedNext !== null ? Math.abs(s2.seekedAt - expectedNext / 1000) : null;
    record('E2', d2 !== null && d2 <= 0.5 && !consoleBad() ? 'PASS' : 'FAIL',
      `activa=${(starts[activeIdx] / 1000).toFixed(2)}s; seekedAt=${s2.seekedAt}s, siguiente=${expectedNext === null ? 'n/a' : (expectedNext / 1000).toFixed(3)}s, |Δ|=${d2 === null ? 'n/a' : d2.toFixed(3)}`);

    // E3 — Anterior: the previous cue's exact start.
    await pause(page);
    await page.waitForTimeout(300);
    const cur3 = (await S(page)).t * 1000;
    const active3 = starts.reduce((best, st, i) => (st <= cur3 + 50 && i > best ? i : best), 0);
    await hookSeek(page);
    await press(page, 'prev|anterior');
    await page.waitForTimeout(1_500);
    const s3 = await S(page);
    const expectedPrev = starts[active3 - 1] ?? null;
    const d3 = s3.seekedAt !== null && expectedPrev !== null ? Math.abs(s3.seekedAt - expectedPrev / 1000) : null;
    record('E3', d3 !== null && d3 <= 0.5 && !consoleBad() ? 'PASS' : 'FAIL',
      `activa=${(starts[active3] / 1000).toFixed(2)}s; seekedAt=${s3.seekedAt}s, anterior=${expectedPrev === null ? 'n/a' : (expectedPrev / 1000).toFixed(3)}s, |Δ|=${d3 === null ? 'n/a' : d3.toFixed(3)}`);
    await ensureRail(page, false);
  }
} catch (e) { record('D4', 'FAIL', String(e).split('\n')[0]); }

// ── B3: latency in video time, with overlap annotation ───────────────────
try {
  await page.evaluate(() => { const v = document.querySelector('video'); if (v?.paused) void v.play(); });
  await page.waitForTimeout(1_000);
  const samples = await page.evaluate(async () => {
    const nf = () => (document.querySelector('.player-timedtext-text-container')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const kv = () => (document.getElementById('kivara-lingo-video-host')?.shadowRoot?.querySelector('[data-kivara-caption-box]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const v = document.querySelector('video');
    const out = [];
    let lastN = nf();
    let lastK = kv();
    let nAt = null;
    let waiting = false;
    const started = performance.now();
    return await new Promise((resolve) => {
      const id = setInterval(() => {
        const n = nf();
        const k = kv();
        const now = v ? v.currentTime : 0;
        if (n !== lastN) { lastN = n; nAt = now; waiting = true; }
        if (k !== lastK) {
          lastK = k;
          if (waiting && nAt !== null) {
            out.push({ deltaMs: Math.round((now - nAt) * 1000), nText: n.slice(0, 40), kText: k.slice(0, 40), atS: Math.round(now * 100) / 100 });
            waiting = false;
          }
        }
        if (performance.now() - started > 90_000 || out.length >= 10) {
          clearInterval(id);
          resolve(out);
        }
      }, 15);
    });
  });
  fs.writeFileSync(QA + '/b3-samples.json', JSON.stringify(samples, null, 1));
  const over = samples.filter((s) => s.deltaMs > 300);
  record('B3', samples.length >= 10 && over.length === 0 ? 'PASS' : (samples.length ? 'FAIL' : 'NO PROBADO'),
    `muestras=${samples.length}; >300ms=${over.length}; deltas=${JSON.stringify(samples.map((s) => s.deltaMs))}`,
    over.length ? `frases con desfase: ${JSON.stringify(over.map((s) => ({ at: s.atS, delta: s.deltaMs, nf: s.nText })))}` : '');
} catch (e) { record('B3', 'FAIL', String(e).split('\n')[0]); }

await browser.close().catch(() => {});
console.log('QA V2 DONE');
