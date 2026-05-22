/**
 * Subtitle parsers (WebVTT, TTML / DFXP). Kept dependency-free so they can
 * run in both the MAIN and ISOLATED worlds.
 *
 * Each parser produces `RawCue[]` — the platform adapter is responsible for
 * tagging with `language` and assigning stable ids.
 */

export interface RawCue {
  start: number;
  end: number;
  text: string;
  /**
   * Native horizontal alignment if the source carried one. WebVTT cue
   * settings (`align:start`) and TTML `tts:textAlign` are the two sources we
   * extract here. Adapters forward this to `SubtitleCue.align`; the overlay
   * decides whether to honor it via the user's settings toggle.
   */
  align?: 'start' | 'center' | 'end' | 'left' | 'right';
}

function normalizeAlign(
  raw: string | undefined | null,
): RawCue['align'] | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'start' || v === 'left') return 'start';
  if (v === 'end' || v === 'right') return 'end';
  if (v === 'center' || v === 'middle' || v === 'centre') return 'center';
  return undefined;
}

function timeStringToMs(input: string): number {
  // Accepts: HH:MM:SS.mmm | HH:MM:SS,mmm | MM:SS.mmm | SS.mmm | secs ('1.234s') | clock ('00:01:23:12')
  const trimmed = input.trim();
  if (!trimmed) return 0;

  // Plain seconds with optional 's' suffix.
  if (/^[0-9]+(?:\.[0-9]+)?s?$/.test(trimmed)) {
    return Math.round(parseFloat(trimmed) * 1000);
  }

  // SMPTE ticks (not common) — not supported.
  const cleaned = trimmed.replace(',', '.');
  const parts = cleaned.split(':');
  let h = 0;
  let m = 0;
  let s = 0;
  if (parts.length === 3) {
    h = parseInt(parts[0], 10) || 0;
    m = parseInt(parts[1], 10) || 0;
    s = parseFloat(parts[2]) || 0;
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10) || 0;
    s = parseFloat(parts[1]) || 0;
  } else {
    s = parseFloat(parts[0]) || 0;
  }
  return Math.round((h * 3600 + m * 60 + s) * 1000);
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parse WebVTT text (e.g. Disney+/HBO Max external subtitle file). */
export function parseWebVTT(input: string): RawCue[] {
  if (!input) return [];
  const lines = input.replace(/\r/g, '').split('\n');
  const cues: RawCue[] = [];
  let i = 0;
  // Skip WEBVTT header (first non-empty line) and any NOTE / STYLE blocks.
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    if (/^WEBVTT/i.test(line) || /^NOTE/i.test(line) || /^STYLE/i.test(line) || /^REGION/i.test(line)) {
      // Skip until blank line
      while (i < lines.length && lines[i].trim() !== '') i++;
      continue;
    }
    break;
  }
  while (i < lines.length) {
    // Optional cue identifier
    let line = lines[i]?.trim() ?? '';
    if (!line) {
      i++;
      continue;
    }
    let timingLine: string | null = null;
    if (line.includes('-->')) {
      timingLine = line;
    } else {
      i++;
      timingLine = lines[i]?.trim() ?? null;
    }
    if (!timingLine || !timingLine.includes('-->')) {
      i++;
      continue;
    }
    const [rawStart, rawRest] = timingLine.split('-->');
    const restTokens = rawRest.trim().split(/\s+/);
    const rawEnd = restTokens[0];
    const start = timeStringToMs(rawStart);
    const end = timeStringToMs(rawEnd);
    // The remaining tokens are cue settings: `align:start`, `position:50%`,
    // `line:0%` etc. Only `align` interests us here.
    let cueAlign: RawCue['align'] | undefined;
    for (let k = 1; k < restTokens.length; k++) {
      const tok = restTokens[k];
      if (tok.toLowerCase().startsWith('align:')) {
        cueAlign = normalizeAlign(tok.slice(6));
        break;
      }
    }
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }
    const text = stripHtml(textLines.join('\n'));
    if (text) cues.push({ start, end, text, align: cueAlign });
  }
  return cues;
}

/**
 * Parse TTML / DFXP (used by Netflix, Prime Video). Both are XML-based with
 * `<p begin="..." end="..." ...>text</p>` elements. Some platforms wrap text
 * in `<span>` lines.
 */
export function parseTTML(input: string): RawCue[] {
  if (!input) return [];
  // Pull out the tickRate (optional) to convert "1234567t" timings.
  const tickMatch = /tickRate\s*=\s*"(\d+)"/.exec(input);
  const tickRate = tickMatch ? parseInt(tickMatch[1], 10) : 0;

  const cues: RawCue[] = [];
  // Match `<p ...>...</p>` blocks, then look at the *opening tag* for align /
  // textAlign hints.
  const pRegex = /<p\b([^>]*?)begin\s*=\s*"([^"]+)"([^>]*?)end\s*=\s*"([^"]+)"([^>]*)>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(input))) {
    const start = tickToMs(match[2], tickRate);
    const end = tickToMs(match[4], tickRate);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const openTag = `${match[1]}${match[3]}${match[5]}`;
    // `tts:textAlign="start"` is the standard TTML attribute; some streams
    // also emit a plain `align` attribute.
    const alignAttr =
      /\b(?:tts:)?text-?align\s*=\s*"([^"]+)"/i.exec(openTag)?.[1] ??
      /\balign\s*=\s*"([^"]+)"/i.exec(openTag)?.[1];
    const cueAlign = normalizeAlign(alignAttr);
    // Replace <br/> with newline before stripping
    const withBreaks = match[6].replace(/<br\s*\/?\s*>/gi, '\n');
    // Replace <span ...>X</span> with X
    const flat = withBreaks.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1');
    const text = stripHtml(flat);
    if (text) cues.push({ start, end, text, align: cueAlign });
  }
  return cues;
}

function tickToMs(value: string, tickRate: number): number {
  const v = value.trim();
  if (/t$/i.test(v) && tickRate > 0) {
    const ticks = parseFloat(v.slice(0, -1));
    if (!Number.isFinite(ticks)) return NaN;
    return Math.round((ticks / tickRate) * 1000);
  }
  return timeStringToMs(v);
}

/** Detect kind from content + URL. */
export function detectSubtitleKind(url: string, body: string): 'webvtt' | 'ttml' | 'dfxp' | 'json3' | null {
  if (/^\s*WEBVTT/i.test(body)) return 'webvtt';
  if (/^\s*<\??xml[^>]*\?>/i.test(body) || /<tt[\s>]/i.test(body)) {
    // DFXP is functionally a TTML subset; we parse both with parseTTML.
    if (/\.dfxp(\b|\?|$)/i.test(url)) return 'dfxp';
    return 'ttml';
  }
  // YouTube's default subtitle format. The body is JSON with an `events`
  // array, each event has `tStartMs`, `dDurationMs` and a `segs` array
  // of `{ utf8: "…" }`. The URL also carries `fmt=json3`.
  if (/[?&]fmt=json3\b/i.test(url) || /^\s*\{\s*"wireMagic"/i.test(body)) {
    return 'json3';
  }
  return null;
}

/**
 * Parse YouTube JSON3 captions. Each `event` is one cue (or a layout cue
 * with `aAppend` we ignore). Multi-line cues come in as multiple `segs`,
 * with `\n` already inside `utf8` for hard line breaks.
 *
 * Spec reference: https://github.com/shellscape/yt-subtitle-format-json3
 */
function parseJSON3(body: string): RawCue[] {
  const cues: RawCue[] = [];
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return cues;
  }
  if (!json || typeof json !== 'object') return cues;
  const events = (json as { events?: unknown }).events;
  if (!Array.isArray(events)) return cues;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as {
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string; acAsrConf?: number }>;
      aAppend?: number;
      // YouTube sometimes ships layout-only events (`wpWinPosId`) without
      // segs — skip them so we don't push empty cues.
    };
    // `aAppend === 1` = continuation of previous cue's text. Skip — for
    // our purposes the user wants discrete cues, not the running text
    // that YouTube uses for word-by-word reveal animations.
    if (e.aAppend === 1) continue;
    if (typeof e.tStartMs !== 'number' || typeof e.dDurationMs !== 'number') continue;
    if (!Array.isArray(e.segs) || e.segs.length === 0) continue;
    const start = e.tStartMs;
    const end = e.tStartMs + e.dDurationMs;
    const text = e.segs
      .map((s) => (typeof s.utf8 === 'string' ? s.utf8 : ''))
      .join('')
      .replace(/\u200b/g, '') // zero-width spaces YouTube sometimes injects
      .trim();
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

export function parseAny(url: string, body: string): RawCue[] {
  const kind = detectSubtitleKind(url, body);
  if (kind === 'webvtt') return parseWebVTT(body);
  if (kind === 'ttml' || kind === 'dfxp') return parseTTML(body);
  if (kind === 'json3') return parseJSON3(body);
  return [];
}

/**
 * Best-effort BCP-47 language detection for an intercepted subtitle track.
 *
 * Tries (in order):
 *   1. Body markers — TTML `xml:lang="..."` on the root element, or WebVTT
 *      `Language: xx` header (HBO Max ships these).
 *   2. URL hints — common HLS/DASH path conventions (`/subtitles/es/`,
 *      `?lang=es-419`, `t/sub/es/...`) plus per-platform quirks.
 *
 * Returns the two-letter primary subtag in lowercase ("es", "en", "pt").
 * Returns `null` when nothing matches — callers should treat that as
 * "unknown language" rather than guessing.
 */
export function detectTrackLanguage(url: string, body: string): string | null {
  // 1. WebVTT header `Language: es`
  const vttLang = /^\s*WEBVTT[\s\S]*?^\s*Language\s*:\s*([A-Za-z][A-Za-z0-9-]*)/im.exec(body);
  if (vttLang) return normalizeLang(vttLang[1]);

  // 2. TTML / DFXP `xml:lang="es"` on the root.
  const xmlLang = /<tt[^>]*\bxml:lang\s*=\s*"([^"]+)"/i.exec(body);
  if (xmlLang) return normalizeLang(xmlLang[1]);

  // 3. URL hints — order matters; the most specific patterns win.
  const fromUrl = languageFromUrl(url);
  if (fromUrl) return fromUrl;

  return null;
}

function normalizeLang(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  // Strip region (es-419, en-US) — Kivara only cares about the primary tag
  // for picking the dual-caption source. Callers that need the full tag can
  // grab it from the bus value if we ever expose it.
  return trimmed.split(/[-_]/)[0] || null;
}

function languageFromUrl(url: string): string | null {
  try {
    const u = new URL(url, 'https://x.invalid/');
    // a) YouTube auto-translate: `?lang=en&tlang=es` — the actual content
    //    of the response IS in `tlang`, not `lang`. Check `tlang` first
    //    so the bus stores translated tracks under the right key.
    const tlang = u.searchParams.get('tlang');
    if (tlang) {
      const n = normalizeLang(tlang);
      if (n && /^[a-z]{2}$/.test(n)) return n;
    }
    // b) Query strings: ?lang=es / ?language=es-419 / ?l=es
    for (const key of ['lang', 'language', 'l', 'locale']) {
      const v = u.searchParams.get(key);
      if (v) {
        const n = normalizeLang(v);
        if (n && /^[a-z]{2}$/.test(n)) return n;
      }
    }
    // c) Path segments — match `/<lang>/` where <lang> is xx or xx-yy.
    //    Examples from real streams:
    //      .../t/sub/es-419/segment-1.vtt   (HBO Max)
    //      .../subtitles/spa/...            (3-letter ISO; map below)
    //      .../subs/es/...                  (Disney+)
    const segs = u.pathname.split('/').filter(Boolean);
    for (const seg of segs) {
      const exact = /^([a-z]{2})(?:[-_][a-z0-9]{2,4})?$/i.exec(seg);
      if (exact) return exact[1].toLowerCase();
    }
    // d) 3-letter ISO 639-2 fallback for a handful of common languages.
    const iso3 = /\b(spa|eng|por|fre|fra|ger|deu|ita|jpn|kor|chi|zho)\b/i.exec(url);
    if (iso3) {
      const map: Record<string, string> = {
        spa: 'es', eng: 'en', por: 'pt', fre: 'fr', fra: 'fr',
        ger: 'de', deu: 'de', ita: 'it', jpn: 'ja', kor: 'ko',
        chi: 'zh', zho: 'zh',
      };
      return map[iso3[1].toLowerCase()] ?? null;
    }
  } catch {
    // ignore — malformed URL
  }
  return null;
}
