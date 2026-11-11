/** Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged. */

/**
 * Text of a subtitle, cleaned for learning. Two levels:
 *
 * 1. `cueText` — what is shown. Drops the track markup: HTML/TTML/WebVTT
 *    (<i>, <b>, <font>, <c.class>, <v Name>, <br/>, ruby <rt> readings,
 *    karaoke timestamps), ASS/SSA ({\an8}, {\i1}, \N, \h), entities
 *    (&amp;, &#39;...) and invisible characters (BOM, zero-width space,
 *    direction marks). Applied once, when reading the track (data/transcript).
 * 2. `noteRanges` — what is shown but neither spoken nor learned: descriptions
 *    for the deaf ([door slams], (laughs), *sigh*), who speaks (JOHN:) and
 *    music (♪ ... ♪, or the whole line when it starts or ends with ♪). They are
 *    shown dimmed and never count: the tokenizer emits them as signs (they are
 *    not vocabulary, nor coverage, nor episode list) and the context sentence
 *    removes them (`maskNotes` replaces them with spaces: positions still hold
 *    for the target word).
 *
 * Conservative criteria: a speaker name is in UPPERCASE followed by «:»;
 * parentheses are treated as a description (in subtitles dialogue almost never
 * uses them, and descriptions in old tracks do).
 */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '...', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', lrm: '', rlm: '',
};
/** BOM, zero-width space, word joiner, soft hyphen and direction controls (not ZWJ/ZWNJ: they carry meaning). */
const INVISIBLE = /[\uFEFF\u200B\u2060\u00AD\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Visible text of a line: no markup, real line breaks and normalized spaces. */
export function cueText(raw: string): string {
  const s = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?[a-z][^<>]*>|<\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?>/gi, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    })
    .replace(INVISIBLE, '')
    .replace(/\u00A0/g, ' ');
  return s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

export type NoteKind = 'sound' | 'speaker' | 'music';
export interface NoteRange { start: number; end: number; kind: NoteKind }

/** Speaker name: at the start of the line, after a dialogue dash or after the end of another reply («Hi. MARY: Hello»). */
const SPEAKER = /(^|\n|[.!?…]["'”’»)\]]*[ \t]+)([ \t]*[-–—][ \t]*)?([\p{Lu}\p{N}][\p{Lu}\p{M}\p{N} .'’&#-]{0,30}):(?=[ \t]|$)/gmu;
const PATTERNS: [NoteKind, RegExp][] = [
  ['music', /[♪♫][^♪♫\n]*[♪♫]/gu],
  ['music', /^[ \t]*[♪♫][^\n]*$|^[^\n]*[♪♫][ \t]*$/gmu],
  ['music', /^[ \t]*#[ \t][^\n]*$/gm],
  ['music', /[♪♫]+/gu],
  ['sound', /\[[^\]]{0,80}\]|\([^)]{0,80}\)|（[^）]{0,80}）|【[^】]{0,80}】/gu],
  ['sound', /\*[^*\n]{1,40}\*/gu],
];

/** Ranges of the text that are not speech (descriptions, speakers, music), sorted and non-overlapping. */
export function noteRanges(text: string): NoteRange[] {
  const found: NoteRange[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) found.push({ start: m.index, end: m.index + m[0].length, kind });
  }
  for (const m of text.matchAll(SPEAKER)) {
    const name = m[3];
    // A name: at least two uppercase letters and no lowercase («JOHN:», «MAN 2:»; not «I:» nor «Look:»).
    if ((name.match(/\p{Lu}/gu)?.length ?? 0) < 2) continue;
    const start = m.index + m[1].length + (m[2]?.length ?? 0);
    found.push({ start, end: start + name.length + 1, kind: 'speaker' });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: NoteRange[] = [];
  for (const r of found) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Same length as the original: notes become spaces (line breaks are kept). */
export function maskNotes(text: string, ranges = noteRanges(text)): string {
  if (!ranges.length) return text;
  let out = '';
  let at = 0;
  for (const r of ranges) {
    out += text.slice(at, r.start) + text.slice(r.start, r.end).replace(/[^\n]/g, ' ');
    at = r.end;
  }
  return out + text.slice(at);
}

/** What is spoken in the line, on a single line (to copy, to read aloud). */
export function speechText(text: string): string {
  return maskNotes(text)
    .replace(/(^|\n)[ \t]*[-–—][ \t]+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Where each speaker's turn starts: dialogue dash at the start of a line
 * («- Are you coming?⏎- Yes.»), dash after the end of a reply
 * («coming? - Yes.») or speaker name. A sentence never joins another
 * speaker's.
 */
export function turnStarts(text: string, ranges = noteRanges(text)): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/(^|\n)[ \t]*[-–—](?=[ \t]*\S)/g)) out.add(m.index + m[1].length);
  for (const m of text.matchAll(/[.!?…]["'”’»)\]]*[ \t]+[-–—][ \t]+/gu)) out.add(m.index + m[0].search(/[-–—]/));
  ranges.forEach((r) => { if (r.kind === 'speaker') out.add(r.start); });
  return [...out].sort((a, b) => a - b);
}
