// Part 2 — sixth pass: B4 (raw begin formats), C2 (stub Audio + speech to
// see which path plays), D5 (rail retries), E1/E9 (absent-at-rest counts as
// hidden), J4 (registry read, not just Anki), F2.
//
//   node qa-rest-v6.mjs
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

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => /\/watch\//.test(p.url()));
if (!page) { console.log('NO WATCH PAGE'); process.exit(1); }
page.on('console', (m) => consoleLines.push(m.text()));
await page.bringToFront().catch(() => {});

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

/** Netflix TTML begin → ms: "00:01:23.456", "1:23.456s", "83.456s", "83.456". */
const parseBegin = (raw) => {
  const parts = raw.replace(/s$/i, '').trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000);
};

try {
  await page.waitForFunction(() => !!document.getElementById('kivara-lingo-video-host'), { timeout: 45_000 }).catch(() => {});
  await sleep(2_000);

  /* ── B4 · two lines and italics, robust begin parser ────────────────── */
  try {
    const dump = await page.evaluate(() => new Promise((resolve) => {
      (async () => {
        const res = performance.getEntriesByType('resource').map((e) => e.name);
        const found = [];
        let ttml = 0;
        const parseBegin = (raw) => {
          const parts = raw.replace(/s$/i, '').trim().split(':').map(Number);
          if (parts.some((n) => !Number.isFinite(n))) return NaN;
          return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000);
        };
        for (const url of res.filter((u) => /nflxvideo\.net/.test(u))) {
          try {
            const body = await (await fetch(url)).text();
            if (!/<tt[\s>]/i.test(body)) continue;
            ttml++;
            for (const m of body.matchAll(/<p\b[^>]*begin\s*="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
              const raw = m[2];
              const italics = /<(i|em)\b/i.test(raw);
              const br = /<br\s*\/?>/i.test(raw) || (raw.match(/\n/g) || []).length > 1;
              if (italics || br) {
                found.push({ begin: m[1], at: parseBegin(m[1]), italics, br, text: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) });
              }
            }
          } catch { /* next */ }
        }
        resolve({ ttml, found: found.slice(0, 4) });
      })();
    }));
    console.log('B4 raw', JSON.stringify(dump.found.map((f) => ({ begin: f.begin, at: f.at }))));
    const cue = dump.found.find((f) => Number.isFinite(f.at) && f.at > 3_000) ?? dump.found[0];
    if (!cue || !Number.isFinite(cue.at)) {
      record('B4', 'NO PROBADO', `TTML=${dump.ttml}; begin crudo=${JSON.stringify(dump.found.map((f) => f.begin))}`);
    } else {
      await seekMs(cue.at + 150);
      let plate = '';
      for (let i = 0; i < 6 && !plate; i++) { await sleep(1_500); plate = (await readShadow(page)).caption; }
      const seekedAt = await page.evaluate(() => window.__seekedAt ?? null);
      const shows = plate.length > 0 && cue.text.split(' ').some((w) => w.length > 3 && plate.toLowerCase().includes(w.toLowerCase()));
      record('B4', shows ? 'PASS' : 'FAIL',
        `begin="${cue.begin}" → ${cue.at} ms; seekedAt=${seekedAt}s; frase con ${cue.italics ? 'cursivas ' : ''}${cue.br ? 'salto ' : ''}→ placa="${plate.slice(0, 120)}" esperada="${cue.text}"`,
        shows ? '' : 'la placa no mostró la frase');
    }
  } catch (e) { record('B4', 'FAIL', String(e).split('\n')[0]); }

  /* ── C2 · pronunciation: stub Audio + speech, then click ────────────── */
  try {
    await ensurePlaying();
    let st = await waitForCue(6);
    if (!st.caption) {
      const first = await page.evaluate(async () => {
        const parseBegin = (raw) => {
          const parts = raw.replace(/s$/i, '').trim().split(':').map(Number);
          if (parts.some((n) => !Number.isFinite(n))) return NaN;
          return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000);
        };
        for (const url of performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /nflxvideo\.net/.test(u))) {
          try {
            const body = await (await fetch(url)).text();
            if (!/<tt[\s>]/i.test(body)) continue;
            const m = /<p\b[^>]*begin\s*="([^"]+)"/.exec(body);
            if (!m) continue;
            const at = parseBegin(m[1]);
            return Number.isFinite(at) && at > 5_000 ? at : null;
          } catch { /* next */ }
        }
        return null;
      });
      if (first) { await seekMs(first + 300); await sleep(2_500); st = await waitForCue(5); }
    }
    const words = await plateWords();
    const word = words.find((w) => /^[a-z]{3,12}$/i.test(w)) ?? words[0];
    const hovered = await hoverToken(word);
    await sleep(800);
    const speaking = await page.evaluate(async (w) => {
      const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
      const btn = [...(root?.querySelectorAll('button') ?? [])].find((b) => /pronunciaci|pronunciation/i.test(b.getAttribute('aria-label') ?? ''));
      if (!btn) return { found: false };
      // Stub both channels BEFORE clicking: the card tries remote audio first
      // and only falls back to speechSynthesis.
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
  } catch (e) { record('C2', 'FAIL', String(e).split('\n')[0]); }

  /* ── D5 · transcript search (rail retries) ──────────────────────────── */
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
      const before = await page.evaluate(() => [...(document.getElementById('kivara-lingo-host')?.shadowRoot?.querySelectorAll('[data-kvl-cue]') ?? [])].length);
      const inputInfo = await page.evaluate(() => {
        const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        const input = p?.querySelector('input');
        if (input) return { present: true };
        const el = [...(p?.querySelectorAll('button') ?? [])].find((b) => /buscar|search/i.test(b.getAttribute('aria-label') ?? ''));
        if (!el) return { present: false };
        const r = el.getBoundingClientRect();
        return { present: false, searchBtn: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
      });
      if (!inputInfo.present && inputInfo.searchBtn) {
        await page.mouse.click(inputInfo.searchBtn.x, inputInfo.searchBtn.y);
        await sleep(1_200);
      }
      const hasInput = await page.evaluate(() => !!document.getElementById('kivara-lingo-host')?.shadowRoot?.querySelector('input'));
      if (!hasInput) {
        record('D5', 'NO PROBADO', `rail abierta (${before} filas) sin input de búsqueda`);
      } else {
        const typed = await page.evaluate(() => {
          const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
          const input = p.querySelector('input');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'escaped');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        });
        await sleep(2_500);
        const after = await page.evaluate(() => {
          const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
          const rows = [...(p?.querySelectorAll('[data-kvl-cue]') ?? [])].map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim());
          return { rows: rows.length, sample: rows.slice(0, 3), all: rows.every((r) => r.toLowerCase().includes('escaped')) };
        });
        record('D5', typed && after.rows > 0 && after.rows < before ? 'PASS' : 'FAIL',
          `rail filas ${before} → ${after.rows} tras buscar "escaped" (todas coinciden=${after.all}); muestra=${JSON.stringify(after.sample.map((s) => s.slice(0, 40)))}`);
        if (railBtn) { await page.mouse.click(railBtn.x, railBtn.y); await sleep(1_000); }
      }
    }
  } catch (e) { record('D5', 'FAIL', String(e).split('\n')[0]); }

  /* ── E1 (other half) + E9 · controls absent at rest = hidden ────────── */
  try {
    const sel = 'control-nav-back';
    const probe = () => page.evaluate((u) => {
      const el = document.querySelector(`[data-uia="${u}"]`);
      if (!el) return { absent: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        absent: false,
        visible: cs.opacity !== '0' && cs.visibility !== 'hidden' && cs.display !== 'none' && r.height > 0,
        opacity: cs.opacity,
      };
    }, sel);
    await sleep(5_000);
    const rest = await probe();
    await wake();
    const moved = await probe();
    const hiddenAtRest = rest.absent || !rest.visible;
    record('E1', hiddenAtRest && !moved.absent && moved.visible ? 'PASS' : 'FAIL',
      `[data-uia="${sel}"] reposo: ${rest.absent ? 'controles desmontados del DOM' : `visible=${rest.visible} (opacity=${rest.opacity})`} → al mover: ${moved.absent ? 'ausente' : `visible=${moved.visible} (opacity=${moved.opacity})`}`);
    record('E9', hiddenAtRest && !moved.absent && moved.visible ? 'PASS' : 'FAIL',
      `«Limpieza visual» activa (hideUI=true): controles de Netflix ${rest.absent ? 'desmontados' : `ocultos (opacity=${rest.opacity})`} en reposo y de vuelta al mover el ratón (opacity=${moved.absent ? 'n/d' : moved.opacity})`);
  } catch (e) { record('E1', 'FAIL', String(e).split('\n')[0]); record('E9', 'FAIL', String(e).split('\n')[0]); }

  /* ── J4 · 35 s idle, then save; read the registry row ───────────────── */
  let j4Note = null;
  try {
    const sw = ctx.serviceWorkers().find((s) => s.url().includes('service-worker'));
    const beforeIds = (await anki('findNotes', { query: 'deck:"Kivara QA"' })).result ?? [];
    const regBefore = sw ? await sw.evaluate(async () => {
      const got = await chrome.storage.local.get('kvl:cards.recent');
      const rows = got['kvl:cards.recent'] ?? [];
      return rows.length;
    }) : 0;
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
      let row = null;
      let noteId = null;
      for (let i = 0; i < 12 && !noteId; i++) {
        await sleep(3_000);
        if (sw) {
          const rows = await sw.evaluate(async () => {
            const got = await chrome.storage.local.get('kvl:cards.recent');
            return got['kvl:cards.recent'] ?? [];
          });
          if (rows.length > regBefore) {
            row = rows[0];
            noteId = row.noteId ?? null;
          }
        }
        if (!noteId) {
          const ids = (await anki('findNotes', { query: 'deck:"Kivara QA"' })).result ?? [];
          noteId = ids.find((id) => !beforeIds.includes(id)) ?? null;
        }
      }
      j4Note = noteId;
      record('J4', noteId || row?.status === 'saved' ? 'PASS' : 'FAIL',
        `35 s sin ratón (pausada=${afterIdle.paused}) → Guardar sobre "${word}" → nota=${noteId ?? 'n/d'} registro=${JSON.stringify(row ?? null).slice(0, 160)}`);
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
        imgField ? '' : 'fuentes de imágenes activas por defecto (wikimedia/openverse/duckduckgo); la nota salió sin imagen');
    }
  } catch (e) { record('F2', 'FAIL', String(e).split('\n')[0]); }

  fs.writeFileSync(QA + '/console-rest-v6.json', JSON.stringify(consoleLines.slice(-400), null, 1));
  await page.screenshot({ path: QA + '/part2-rest-v6.png' }).catch(() => {});
} catch (e) {
  console.log('FATAL', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  console.log('REST V6 DONE');
}
