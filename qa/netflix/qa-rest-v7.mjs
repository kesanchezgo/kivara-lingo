// Part 2 — seventh pass: restore the QA deck mapping first (the store lost it,
// J4's card died with no-deck), then B4 (ticks), C2, D5 (existing word),
// J4+F2.
//
//   node qa-rest-v7.mjs
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const QA = process.env.KIVARA_QA_DIR ?? 'C:/Users/Kiva/AppData/Local/Temp/kivara-qa';
const R = JSON.parse(fs.existsSync(QA + '/results.json') ? fs.readFileSync(QA + '/results.json', 'utf8') : '{}');
const record = (id, status, evidence, note = '') => {
  R[id] = { status, evidence, note, at: new Date().toISOString() };
  fs.writeFileSync(QA + '/results.json', JSON.stringify(R, null, 1));
  console.log(`[${id}] ${status} — ${String(evidence).slice(0, 340)}${note ? ' — ' + note : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consoleLines = [];
const anki = async (action, params = {}) => {
  const res = await fetch('http://127.0.0.1:8765', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  return res.json().catch(() => null);
};

const QA_MAPPING = {
  ankiUrl: 'http://127.0.0.1:8765',
  apiKey: '',
  deckName: 'Kivara QA',
  modelName: 'Kivara QA Basic',
  fieldSources: { Front: 'selection', Sentence: 'cue', Image: 'frame', Audio: 'sentence-audio' },
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => /\/watch\//.test(p.url()));
if (!page) { console.log('NO WATCH PAGE'); process.exit(1); }
page.on('console', (m) => consoleLines.push(m.text()));
await page.bringToFront().catch(() => {});

const sw = ctx.serviceWorkers().find((s) => s.url().includes('service-worker'));

const pickProfile = async () => {
  const tile = page.locator('[data-uia^="profile-selector+tile-"]').filter({ hasText: /primos/i }).first();
  for (let i = 0; i < 6 && (await tile.count()) > 0; i++) { await tile.click({ timeout: 5_000 }).catch(() => {}); await sleep(5_000); }
};
const wake = async () => { await page.mouse.move(640, 400); await sleep(250); await page.mouse.move(662, 424); await sleep(500); };
const readShadow = () => page.evaluate(() => {
  const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
  const pick = (sel) => (root?.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const v = document.querySelector('video');
  return { caption: pick('[data-kivara-caption-box]'), dual: pick('[data-kivara-dual]'), host: !!root, paused: v?.paused ?? null };
});
const ensurePlaying = () => page.evaluate(() => { const v = document.querySelector('video'); if (v?.paused) void v.play(); });
const waitForCue = async (tries = 14) => {
  await ensurePlaying();
  for (let i = 0; i < tries; i++) {
    const st = await readShadow();
    if (st.caption) return st;
    await sleep(2_000);
    ensurePlaying();
  }
  return readShadow();
};
const plateWords = () => page.evaluate(() => {
  const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
  return [...(root?.querySelectorAll('[data-tok-idx]') ?? [])].map((t) => (t.textContent ?? '').trim()).filter(Boolean);
});
const hoverToken = async (word) => {
  for (let i = 0; i < 6; i++) {
    const box = await page.evaluate((w) => {
      const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
      const el = [...(root?.querySelectorAll('[data-tok-idx]') ?? [])].find((t) => (t.textContent ?? '').trim().toLowerCase() === w.toLowerCase());
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, word);
    if (box) { await page.mouse.move(box.x, box.y); await sleep(900); return box; }
    await sleep(1_000);
  }
  return null;
};
const seekMs = (ms) => page.evaluate((m) => {
  const v = document.querySelector('video');
  window.__seekedAt = null;
  v?.addEventListener('seeked', () => { window.__seekedAt = Math.round(v.currentTime * 1000) / 1000; }, { once: true });
  const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sid = vp?.getAllPlayerSessionIds?.()[0];
  const s = sid ? vp.getVideoPlayerBySessionId(sid) : null;
  if (s?.seek) { try { s.seek(m); } catch { if (v) v.currentTime = m / 1000; } }
  else if (v) v.currentTime = m / 1000;
  return true;
}, ms);

/** begin="1713795417t" (ticks), "00:01:23.456", "1:23.4s", "83.4s" → ms. */
const PARSE_BEGIN = `
const parseBegin = (raw, tickRate) => {
  const m = /^(\\d+)t$/i.exec(raw.trim());
  if (m) return Math.round(Number(m[1]) / (tickRate || 10_000_000) * 1000);
  const parts = raw.replace(/s$/i, '').trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000);
};
`;

try {
  await page.waitForFunction(() => !!document.getElementById('kivara-lingo-video-host'), { timeout: 45_000 }).catch(() => {});

  /* ── restore the QA deck mapping (the store lost it) ────────────────── */
  if (sw) {
    const ok = await sw.evaluate(async (mapping) => {
      const KEY = 'kivara-lingo-state';
      const current = await chrome.storage.sync.get(KEY);
      const parsed = current[KEY] ? JSON.parse(current[KEY]) : { state: {}, version: 0 };
      parsed.state = parsed.state ?? {};
      parsed.state.ankiMapping = mapping;
      await chrome.storage.sync.set({ [KEY]: JSON.stringify(parsed) });
      return true;
    }, QA_MAPPING).catch((e) => String(e).slice(0, 80));
    console.log('mapping seeded', JSON.stringify(ok));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
    await sleep(6_000);
    await pickProfile();
    await page.waitForFunction(() => !!document.getElementById('kivara-lingo-video-host'), { timeout: 45_000 }).catch(() => {});
    await sleep(3_000);
  } else {
    console.log('NO SW: mapping NOT restored');
  }

  /* ── B4 · two lines and italics (ticks) ─────────────────────────────── */
  try {
    const dump = await page.evaluate(() => new Promise((resolve) => {
      (async () => {
        const res = performance.getEntriesByType('resource').map((e) => e.name);
        const found = [];
        let ttml = 0;
        let tickRate = null;
        const parseBegin = (raw, tr) => {
          const m = /^(\d+)t$/i.exec(raw.trim());
          if (m) return Math.round(Number(m[1]) / (tr || 10_000_000) * 1000);
          const parts = raw.replace(/s$/i, '').trim().split(':').map(Number);
          if (parts.some((n) => !Number.isFinite(n))) return NaN;
          return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000);
        };
        for (const url of res.filter((u) => /nflxvideo\.net/.test(u))) {
          try {
            const body = await (await fetch(url)).text();
            if (!/<tt[\s>]/i.test(body)) continue;
            ttml++;
            tickRate = Number(/tickRate="(\d+)"/.exec(body)?.[1]) || tickRate;
            for (const m of body.matchAll(/<p\b[^>]*begin\s*="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
              const raw = m[2];
              const italics = /<(i|em)\b/i.test(raw);
              const br = /<br\s*\/?>/i.test(raw) || (raw.match(/\n/g) || []).length > 1;
              if (italics || br) found.push({ begin: m[1], at: parseBegin(m[1], tickRate), italics, br, text: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) });
            }
          } catch { /* next */ }
        }
        resolve({ ttml, tickRate, found: found.slice(0, 4) });
      })();
    }));
    console.log('B4 raw', JSON.stringify({ tickRate: dump.tickRate, found: dump.found.map((f) => ({ begin: f.begin, at: f.at })) }));
    const cue = dump.found.find((f) => Number.isFinite(f.at) && f.at > 3_000) ?? dump.found[0];
    if (!cue || !Number.isFinite(cue.at)) {
      record('B4', 'NO PROBADO', `TTML=${dump.ttml} tickRate=${dump.tickRate}; begin crudo=${JSON.stringify(dump.found.map((f) => f.begin))}`);
    } else {
      await seekMs(cue.at + 150);
      let plate = '';
      for (let i = 0; i < 6 && !plate; i++) { await sleep(1_500); plate = (await readShadow(page)).caption; }
      const seekedAt = await page.evaluate(() => window.__seekedAt ?? null);
      const shows = plate.length > 0 && cue.text.split(' ').some((w) => w.length > 3 && plate.toLowerCase().includes(w.toLowerCase()));
      record('B4', shows ? 'PASS' : 'FAIL',
        `tickRate=${dump.tickRate}; begin="${cue.begin}" → ${cue.at} ms; seekedAt=${seekedAt}s; frase con ${cue.italics ? 'cursivas ' : ''}${cue.br ? 'salto ' : ''}→ placa="${plate.slice(0, 120)}" esperada="${cue.text}"`,
        shows ? '' : 'la placa no mostró la frase');
    }
  } catch (e) { record('B4', 'FAIL', String(e).split('\n')[0]); }

  /* ── C2 · pronunciation with both channels stubbed ──────────────────── */
  try {
    let st = await waitForCue(6);
    if (!st.caption) {
      const first = await page.evaluate(`(() => { ${PARSE_BEGIN} return (async () => {
        for (const url of performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /nflxvideo\\.net/.test(u))) {
          try {
            const body = await (await fetch(url)).text();
            if (!/<tt[\\s>]/i.test(body)) continue;
            const tr = Number(/tickRate="(\\d+)"/.exec(body)?.[1]) || null;
            const m = /<p\\b[^>]*begin\\s*="([^"]+)"/.exec(body);
            if (!m) continue;
            const at = parseBegin(m[1], tr);
            return Number.isFinite(at) && at > 5_000 ? at : null;
          } catch {}
        }
        return null;
      })(); })()`);
      if (first) { await seekMs(first + 300); await sleep(2_500); st = await waitForCue(5); }
    }
    const words = await plateWords();
    const word = words.find((w) => /^[a-z]{3,12}$/i.test(w)) ?? words[0];
    if (!word) {
      record('C2', 'NO PROBADO', 'sin frase en pantalla para hacer hover');
    } else {
      const hovered = await hoverToken(word);
      await sleep(800);
      const speaking = await page.evaluate(async (w) => {
        const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
        const btn = [...(root?.querySelectorAll('button') ?? [])].find((b) => /pronunciaci|pronunciation/i.test(b.getAttribute('aria-label') ?? ''));
        if (!btn) return { found: false };
        const played = { audio: 0, speech: 0 };
        if (!window.__kvlAudioStub) {
          const Native = window.Audio;
          window.Audio = class extends Native {
            play() { window.__kvlAudioPlays = (window.__kvlAudioPlays ?? 0) + 1; return super.play().catch(() => undefined); }
          };
          window.__kvlAudioStub = true;
        }
        window.__kvlAudioPlays = 0;
        const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = (u) => { window.__kvlSpeech = (window.__kvlSpeech ?? 0) + 1; return origSpeak(u); };
        window.__kvlSpeech = 0;
        btn.click();
        await new Promise((r) => setTimeout(r, 6_000));
        window.speechSynthesis.speak = origSpeak;
        return { found: true, audio: window.__kvlAudioPlays, speech: window.__kvlSpeech };
      }, word);
      const ok = speaking.found && (speaking.audio > 0 || speaking.speech > 0);
      record('C2', ok ? 'PASS' : 'FAIL',
        `token="${word}" (hover=${!!hovered}); botón presente=${speaking.found}; audio.play()=${speaking.audio}; speechSynthesis.speak=${speaking.speech}`,
        ok ? '' : 'ningún canal de pronunciación sonó');
      await page.mouse.move(300, 200);
    }
  } catch (e) { record('C2', 'FAIL', String(e).split('\n')[0]); }

  /* ── D5 · transcript search with a word that EXISTS ─────────────────── */
  try {
    let railBtn = null;
    let open = false;
    for (let i = 0; i < 4 && !open; i++) {
      await wake();
      railBtn = await page.evaluate(() => {
        const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
        const el = [...(root?.querySelectorAll('button[aria-label]') ?? [])].find((x) => /transcrip/i.test(x.getAttribute('aria-label') ?? ''));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (!railBtn) { await sleep(1_500); continue; }
      await page.mouse.click(railBtn.x, railBtn.y);
      await sleep(2_500);
      open = await page.evaluate(() => ([...(document.getElementById('kivara-lingo-host')?.shadowRoot?.querySelectorAll('[data-kvl-cue]') ?? [])].length) > 0);
    }
    if (!open) {
      record('D5', 'NO PROBADO', 'la rail no abrió tras 4 intentos');
    } else {
      const firstRowText = await page.evaluate(() => {
        const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        return (p?.querySelector('[data-kvl-cue]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
      const term = (firstRowText.split(' ').find((w) => /^[a-záéíóúñ]{4,}$/i.test(w)) ?? firstRowText.split(' ')[0] ?? '').toLowerCase();
      const before = await page.evaluate(() => [...(document.getElementById('kivara-lingo-host')?.shadowRoot?.querySelectorAll('[data-kvl-cue]') ?? [])].length);
      const typed = await page.evaluate((t) => {
        const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        const input = p.querySelector('input');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, t);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, term);
      await sleep(2_500);
      const after = await page.evaluate((t) => {
        const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        const rows = [...(p?.querySelectorAll('[data-kvl-cue]') ?? [])].map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim());
        return { rows: rows.length, sample: rows.slice(0, 3), all: rows.every((r) => r.toLowerCase().includes(t)) };
      }, term);
      record('D5', typed && after.rows > 0 && after.rows < before ? 'PASS' : 'FAIL',
        `rail filas ${before} → ${after.rows} tras buscar "${term}" (todas coinciden=${after.all}); muestra=${JSON.stringify(after.sample.map((s) => s.slice(0, 40)))}`);
      if (railBtn) { await page.mouse.click(railBtn.x, railBtn.y); await sleep(1_000); }
    }
  } catch (e) { record('D5', 'FAIL', String(e).split('\n')[0]); }

  /* ── J4 · 35 s idle, then save ──────────────────────────────────────── */
  let j4Note = null;
  try {
    const beforeIds = (await anki('findNotes', { query: 'deck:"Kivara QA"' })).result ?? [];
    let word = null;
    for (let i = 0; i < 5 && !word; i++) {
      await waitForCue(8);
      const words = await plateWords();
      word = words.find((w) => /^[a-z]{4,12}$/i.test(w)) ?? null;
      if (!word) await sleep(2_000);
    }
    const hovered = word ? await hoverToken(word) : null;
    await sleep(1_500);
    const justAfter = await page.evaluate(() => ({
      paused: document.querySelector('video')?.paused ?? null,
      btn: [...(document.getElementById('kivara-lingo-video-host')?.shadowRoot?.querySelectorAll('button') ?? [])].some((b) => (b.getAttribute('aria-label') ?? '') === 'Guardar'),
    }));
    await sleep(35_000);
    const afterIdle = await page.evaluate(() => ({
      paused: document.querySelector('video')?.paused ?? null,
      btn: [...(document.getElementById('kivara-lingo-video-host')?.shadowRoot?.querySelectorAll('button') ?? [])].some((b) => (b.getAttribute('aria-label') ?? '') === 'Guardar'),
    }));
    if (!afterIdle.btn) {
      record('J4', 'FAIL', `token="${word}" hover=${!!hovered}; tras hover paused=${justAfter.paused} btn=${justAfter.btn} → tras 35 s paused=${afterIdle.paused} btn=${afterIdle.btn} (la tarjeta se cerró)`);
    } else {
      const saveBtn = await page.evaluate(() => {
        const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
        const btn = [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.getAttribute('aria-label') ?? '') === 'Guardar');
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(saveBtn.x, saveBtn.y);
      let noteId = null;
      for (let i = 0; i < 12 && !noteId; i++) {
        await sleep(3_000);
        const ids = (await anki('findNotes', { query: 'deck:"Kivara QA"' })).result ?? [];
        noteId = ids.find((id) => !beforeIds.includes(id)) ?? null;
      }
      j4Note = noteId;
      record('J4', noteId ? 'PASS' : 'FAIL',
        `35 s sin ratón (pausada=${afterIdle.paused}) → Guardar sobre "${word}" → nota=${noteId ?? 'no creada'}`,
        noteId ? '' : 'revisa el registro en la tabla');
    }
  } catch (e) { record('J4', 'FAIL', String(e).split('\n')[0]); }

  /* ── F2 · the image on that note ────────────────────────────────────── */
  try {
    if (!j4Note) {
      record('F2', 'NO PROBADO', 'sin nota nueva que inspeccionar (J4 no guardó)');
    } else {
      const info = await anki('notesInfo', { notes: [j4Note] });
      const note = info?.result?.[0];
      const fields = note ? Object.values(note.fields ?? {}) : [];
      const imgField = fields.find((f) => /<img\b/i.test(f?.value ?? ''));
      record('F2', imgField ? 'PASS' : 'FAIL',
        `nota ${j4Note}: campos=${fields.length}; campo con imagen=${imgField ? imgField.value.slice(0, 120) : 'ninguno'}`,
        imgField ? '' : 'fuentes de imágenes activas por defecto; la nota salió sin imagen');
    }
  } catch (e) { record('F2', 'FAIL', String(e).split('\n')[0]); }

  fs.writeFileSync(QA + '/console-rest-v7.json', JSON.stringify(consoleLines.slice(-400), null, 1));
  await page.screenshot({ path: QA + '/part2-rest-v7.png' }).catch(() => {});
} catch (e) {
  console.log('FATAL', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  console.log('REST V7 DONE');
}
