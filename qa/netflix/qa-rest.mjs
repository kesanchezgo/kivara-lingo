// Part 2 — ninth pass: seek via video.currentTime directly (verify), rail
// dump after the toggle click, C2/F2 on a dialogue cue.
//
//   node qa-rest-v9.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const QA = process.env.KIVARA_QA_DIR ?? path.join(os.tmpdir(), 'kivara-qa');
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
  return { caption: pick('[data-kivara-caption-box]'), dual: pick('[data-kivara-dual]'), host: !!root, paused: v?.paused ?? null, t: v ? Math.round(v.currentTime * 100) / 100 : null };
});
const ensurePlaying = () => page.evaluate(() => { const v = document.querySelector('video'); if (v?.paused) void v.play(); });
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

/** Seek the media element DIRECTLY (the way a scrub does) and verify. */
const hardSeek = async (ms) => {
  await page.evaluate((m) => {
    const v = document.querySelector('video');
    window.__seekedAt = null;
    v?.addEventListener('seeked', () => { window.__seekedAt = Math.round(v.currentTime * 1000) / 1000; }, { once: true });
    if (v) v.currentTime = m / 1000;
  }, ms);
  for (let i = 0; i < 8; i++) {
    const st = await readShadow();
    if (st.t != null && Math.abs(st.t - ms / 1000) < 2.5) return { ok: true, t: st.t, seekedAt: await page.evaluate(() => window.__seekedAt ?? null) };
    await sleep(1_000);
  }
  const st = await readShadow();
  return { ok: false, t: st.t, seekedAt: await page.evaluate(() => window.__seekedAt ?? null) };
};

try {
  await page.waitForFunction(() => !!document.getElementById('kivara-lingo-video-host'), { timeout: 45_000 }).catch(() => {});
  await sleep(2_000);

  /* ── B4 · two lines/italics at a dialogue cue, direct media seek ────── */
  try {
    await ensurePlaying();
    const dump = await page.evaluate(() => new Promise((resolve) => {
      (async () => {
        const res = performance.getEntriesByType('resource').map((e) => e.name);
        const found = [];
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
            tickRate = Number(/tickRate="(\d+)"/.exec(body)?.[1]) || tickRate;
            for (const m of body.matchAll(/<p\b[^>]*begin\s*="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
              const raw = m[2];
              const italics = /<(i|em)\b/i.test(raw);
              const br = /<br\s*\/?>/i.test(raw) || (raw.match(/\n/g) || []).length > 1;
              if (italics || br) {
                found.push({ begin: m[1], at: parseBegin(m[1], tickRate), italics, br, text: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) });
              }
            }
          } catch { /* next */ }
        }
        resolve({ tickRate, found: found.filter((f) => Number.isFinite(f.at)).slice(0, 8) });
      })();
    }));
    // Prefer a cue with REAL words (sound-effect plates like "-[growling]"
    // carry no dictionary words); fall back to the first one.
    const cue = dump.found.find((f) => /[a-z]{3,}/i.test(f.text.replace(/[[\]\-—]/g, ' '))) ?? dump.found[0];
    if (!cue) {
      record('B4', 'NO PROBADO', `sin frases de dos líneas/cursivas (tickRate=${dump.tickRate})`);
    } else {
      const seek = await hardSeek(cue.at + 200);
      let plate = '';
      for (let i = 0; i < 8 && !plate; i++) { await sleep(1_500); plate = (await readShadow(page)).caption; }
      const shows = plate.length > 0 && cue.text.split(' ').some((w) => w.length > 2 && plate.toLowerCase().includes(w.toLowerCase()));
      record('B4', shows ? 'PASS' : 'FAIL',
        `tickRate=${dump.tickRate}; begin="${cue.begin}"→${cue.at}ms; seek=${JSON.stringify(seek)}; frase ${cue.italics ? 'cursivas ' : ''}${cue.br ? '2 líneas ' : ''}→ placa="${plate.slice(0, 120)}" esperada="${cue.text}"`,
        shows ? '' : 'la placa no mostró la frase');
    }
  } catch (e) { record('B4', 'FAIL', String(e).split('\n')[0]); }

  /* ── C2 · pronunciation on a dialogue word ──────────────────────────── */
  try {
    // Move to a dialogue-rich cue: any TTML cue with 4+ real words.
    const spot = await page.evaluate(() => new Promise((resolve) => {
      (async () => {
        const res = performance.getEntriesByType('resource').map((e) => e.name);
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
            const tr = Number(/tickRate="(\d+)"/.exec(body)?.[1]) || null;
            for (const m of body.matchAll(/<p\b[^>]*begin\s*="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
              const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              const words = text.split(' ').filter((w) => /^[a-zA-Z]{3,}$/.test(w));
              if (words.length >= 4) {
                const at = parseBegin(m[1], tr);
                if (Number.isFinite(at)) return { at, text: text.slice(0, 80) };
              }
            }
          } catch { /* next */ }
        }
        return null;
      })();
    }));
    console.log('C2 spot', JSON.stringify(spot));
    let word = null;
    let hovered = null;
    if (spot) {
      const seek = await hardSeek(spot.at + 300);
      console.log('C2 seek', JSON.stringify(seek));
      await sleep(2_000);
      const words = await plateWords();
      word = words.find((w) => /^[a-z]{3,12}$/i.test(w)) ?? words[0] ?? null;
      if (word) hovered = await hoverToken(word);
    }
    if (!word) {
      record('C2', 'NO PROBADO', `sin palabra para hover (spot=${JSON.stringify(spot)})`);
    } else {
      await sleep(800);
      const consoleBefore = consoleLines.length;
      const speaking = await page.evaluate(async (w) => {
        const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
        const btn = [...(root?.querySelectorAll('button') ?? [])].find((b) => /pronunciaci|pronunciation/i.test(b.getAttribute('aria-label') ?? ''));
        if (!btn) return { found: false };
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
        await new Promise((r) => setTimeout(r, 12_000));
        window.speechSynthesis.speak = origSpeak;
        return { found: true, audio: window.__kvlAudioPlays, speech: window.__kvlSpeech };
      }, word);
      const during = consoleLines.slice(consoleBefore).filter((l) => /pronun|audio|speak|forvo|cambridge|oxford|kivara/i.test(l)).slice(0, 6);
      const ok = speaking.found && (speaking.audio > 0 || speaking.speech > 0);
      record('C2', ok ? 'PASS' : 'FAIL',
        `token="${word}" (hover=${!!hovered}); botón presente=${speaking.found}; audio.play()=${speaking.audio}; speechSynthesis.speak=${speaking.speech}; consola=${JSON.stringify(during)}`,
        ok ? '' : 'ningún canal de pronunciación sonó en 12 s');
      await page.mouse.move(300, 200);
    }
  } catch (e) { record('C2', 'FAIL', String(e).split('\n')[0]); }

  /* ── D5 · transcript search (dump the panel after the toggle) ───────── */
  try {
    let open = false;
    let dump = null;
    for (let i = 0; i < 5 && !open; i++) {
      await wake();
      const railBtn = await page.evaluate(() => {
        const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
        const el = [...(root?.querySelectorAll('button[aria-label]') ?? [])].find((x) => /transcrip/i.test(x.getAttribute('aria-label') ?? ''));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (!railBtn) { await sleep(1_500); continue; }
      await page.mouse.click(railBtn.x, railBtn.y);
      await sleep(2_500);
      dump = await page.evaluate(() => {
        const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        const tabs = [...(p?.querySelectorAll('[role="tab"]') ?? [])].map((el) => (el.textContent ?? '').trim());
        const rows = [...(p?.querySelectorAll('[data-kvl-cue]') ?? [])].length;
        const inputs = [...(p?.querySelectorAll('input') ?? [])].length;
        return { tabs, rows, inputs, any: !!p?.textContent };
      });
      open = dump.rows > 0 || dump.inputs > 0;
    }
    console.log('PANEL dump', JSON.stringify(dump));
    if (!open) {
      record('D5', 'NO PROBADO', `la rail no abrió; panel=${JSON.stringify(dump)}`);
    } else if (dump.inputs === 0) {
      record('D5', 'NO PROBADO', `rail abierta: tabs=${JSON.stringify(dump.tabs)} filas=${dump.rows} inputs=0`);
    } else {
      const firstRowText = await page.evaluate(() => {
        const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        return (p?.querySelector('[data-kvl-cue]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
      const term = (firstRowText.split(' ').find((w) => /^[a-záéíóúñ]{4,}$/i.test(w)) ?? firstRowText.split(' ')[0] ?? '').toLowerCase();
      const before = dump.rows;
      const typed = await page.evaluate((t) => {
        const p = document.getElementById('kivara-lingo-host')?.shadowRoot ?? null;
        const input = p.querySelector('input');
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
      await wake();
      const railBtn2 = await page.evaluate(() => {
        const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
        const el = [...(root?.querySelectorAll('button[aria-label]') ?? [])].find((x) => /transcrip/i.test(x.getAttribute('aria-label') ?? ''));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (railBtn2) { await page.mouse.click(railBtn2.x, railBtn2.y); await sleep(1_000); }
    }
  } catch (e) { record('D5', 'FAIL', String(e).split('\n')[0]); }

  /* ── F2 · save a noun with image access granted ─────────────────────── */
  try {
    await ensurePlaying();
    const beforeIds = (await anki('findNotes', { query: 'deck:"Kivara QA"' })).result ?? [];
    let word = null;
    for (let i = 0; i < 8 && !word; i++) {
      const words = await plateWords();
      word = words.find((w) => /^(monster|cabin|lantern|forest|window|flashlight|basement|ceiling|yard|attic|bear|wolf|door|knife|boat|train|storm|river|garden|kitchen|house|night|morning|town|school|friend|father|mother|sister|brother)$/i.test(w)) ?? null;
      if (!word) {
        const spot = await page.evaluate(() => new Promise((resolve) => {
          (async () => {
            const res = performance.getEntriesByType('resource').map((e) => e.name);
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
                const tr = Number(/tickRate="(\d+)"/.exec(body)?.[1]) || null;
                for (const m of body.matchAll(/<p\b[^>]*begin\s*="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
                  const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                  const at = parseBegin(m[1], tr);
                  if (Number.isFinite(at) && at > 60_000) return { at, text };
                }
              } catch { /* next */ }
            }
            return null;
          })();
        }));
        if (spot) { await hardSeek(spot.at + 300); await sleep(2_000); }
        else await sleep(3_000);
      }
    }
    const hovered = word ? await hoverToken(word) : null;
    await sleep(1_200);
    const saveBtn = await page.evaluate(() => {
      const root = document.getElementById('kivara-lingo-video-host')?.shadowRoot ?? null;
      const btn = [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.getAttribute('aria-label') ?? '') === 'Guardar');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (!saveBtn) {
      record('F2', 'FAIL', `token="${word}" hover=${!!hovered}; el botón Guardar no está`);
    } else {
      await page.mouse.click(saveBtn.x, saveBtn.y);
      let noteId = null;
      for (let i = 0; i < 14 && !noteId; i++) {
        await sleep(3_000);
        const ids = (await anki('findNotes', { query: 'deck:"Kivara QA"' })).result ?? [];
        noteId = ids.find((id) => !beforeIds.includes(id)) ?? null;
      }
      if (!noteId) {
        record('F2', 'FAIL', `guardar "${word}" no creó nota`);
      } else {
        const info = await anki('notesInfo', { notes: [noteId] });
        const note = info?.result?.[0];
        const fields = note ? Object.values(note.fields ?? {}) : [];
        const imgField = fields.find((f) => /<img\b/i.test(f?.value ?? ''));
        record('F2', imgField ? 'PASS' : 'FAIL',
          `nota ${noteId} ("${word}"): campos=${fields.length}; imagen=${imgField ? imgField.value.slice(0, 100) : 'ninguna'}; accesos de imagen concedidos en el arnés`,
          imgField ? '' : 'las fuentes siguen sin dar URL');
      }
    }
  } catch (e) { record('F2', 'FAIL', String(e).split('\n')[0]); }

  fs.writeFileSync(QA + '/console-rest-v9.json', JSON.stringify(consoleLines.slice(-500), null, 1));
  await page.screenshot({ path: QA + '/part2-rest-v9.png' }).catch(() => {});
} catch (e) {
  console.log('FATAL', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  console.log('REST V9 DONE');
}
