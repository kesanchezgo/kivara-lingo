/** Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged. */

import { maskNotes, noteRanges, turnStarts } from './subtitleText';

/**
 * The context phrase of a card: the SENTENCE that contains the word, not the
 * whole subtitle line. A line can bring two sentences («Not this time. I can't
 * afford it.») or half of one («I told you that I was» / «working late.»), and
 * a line break is only layout.
 *
 * Rules (those of sentence-mining tools like Yomitan, plus the corrections
 * that subtitles demand):
 *   0. Only what is spoken: descriptions, speakers and music are out
 *      (lib/subtitleText · noteRanges), same as in the tokenizer.
 *   1. The sentence that contains the word, segmented with `Intl.Segmenter`
 *      (granularity 'sentence': respects «Mr.», «U.S.» and scales to
 *      Japanese「。」). A speaker change also cuts (Unicode does not cut before
 *      a dash).
 *   2. If it comes out short (fewer than 4 words: «It's ridiculous.»), the
 *      neighbouring sentence of the same line (the previous one first) is
 *      joined to it, since that is the one that gives it meaning — never one
 *      from another speaker (dialogue dash or «JOHN:»).
 *   3. If the sentence continues on the next line, it is joined with that line:
 *      - with no final punctuation and a gap ≤ 1.5 s (backwards, besides, the
 *        line must start lowercase: «I was working late.» already stands);
 *      - with ellipses that continue («I was...» / «...working late» or
 *        «working late», lowercase), with a gap ≤ 3 s; those of the second line
 *        are dropped: «I was... working late.».
 *      Never with another speaker and never more than two lines.
 *   4. Cap of 30 words: first the other line is released, then the short
 *      neighbour; if still over, it is trimmed by commas or semicolons around
 *      the word and, as a last resort, to 30 words centred on it, with «...».
 *   5. Line breaks → spaces; dialogue dashes out.
 *
 * `span`: the audio stretch of the saved phrase (seconds). The lines used give
 * their start and end; if only part of a line is saved (one of its two
 * sentences, or a trim), the boundary is estimated by the proportion of
 * letters. In production, voice detection refines it over the real audio. Thus
 * the card's audio says exactly what its phrase says.
 */
export interface ContextCue { start: number; end: number; target: string }
export interface Span { start: number; end: number }
export interface ContextSentence { text: string; lines: number[]; span?: Span }

const TERMINAL = /[.!?…。！？]["'”’»)\]]*\s*$/u;
const ELLIPSIS_END = /(?:\.\.\.|…)["'”’»)\]]*\s*$/u;
const ELLIPSIS_START = /^\s*(?:\.\.\.|…)\s*/u;
const SPEECH = /[\p{L}\p{N}]/u;
const MIN_WORDS = 4;
export const MAX_WORDS = 30;
const MAX_GAP_S = 1.5;
const MAX_GAP_ELLIPSIS_S = 3;

interface Seg { start: number; end: number; text: string }

/** Languages that do not separate words with spaces (they need `Intl.Segmenter`). */
const DICTIONARY_SEGMENTED = new Set(['ja', 'zh']);
const LETTER = '[\\p{L}\\p{M}\\p{N}]';
/** Word in space-separated languages: letters of any script, with internal apostrophe or hyphen. */
const SPACED_RE = new RegExp(`${LETTER}+(?:['\\u2018\\u2019\\u02BC\\-\\u2010]${LETTER}+)*|\\s+|[^\\p{L}\\p{M}\\p{N}\\s]+`, 'gu');

/** Splits a text into words, spaces and signs according to how its language separates words. */
function segmentWords(text: string, lang = 'en'): string[] {
  if (DICTIONARY_SEGMENTED.has(lang)) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].map((s) => s.segment);
    }
    return [...text]; // without Intl.Segmenter: one character per word (acceptable in Chinese)
  }
  return text.match(SPACED_RE) ?? [];
}

/** Sentences of a text with their position (characters), according to the language. */
export function segmentSentences(text: string, lang = 'en'): Seg[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text)]
      .map((s) => ({ start: s.index, end: s.index + s.segment.length, text: s.segment }))
      .filter((s) => s.text.trim());
  }
  // Without Intl.Segmenter: split after . ! ? ... followed by a space.
  const out: Seg[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["'”’»)\]]*|$)\s*/gu;
  for (let m = re.exec(text); m && m[0]; m = re.exec(text)) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return out.length ? out : [{ start: 0, end: text.length, text }];
}

// Dialogue dashes out: at the start, after a reply's end («coming? - Yes.» → «coming? Yes.») and at the end.
const tidy = (s: string) => s.replace(/^\s*[-–—]\s+/, '').replace(/([.!?…])\s+[-–—]\s+/g, '$1 ').replace(/\s+[-–—]\s*$/, '').replace(/\s+/g, ' ').trim();
const wordCount = (s: string, lang: string) => segmentWords(s, lang).filter((w) => SPEECH.test(w)).length;
const round = (s: number) => Math.round(s * 100) / 100;

/** A line ready to trim: only speech (notes → spaces, same length), its sentences and its turns. */
interface Line {
  cue: ContextCue;
  text: string;
  sents: Seg[];
  turns: number[];
  /** Letters and digits before each position: time is split by letters, not by spaces or signs. */
  before: number[];
}

function lineOf(cue: ContextCue, lang: string): Line {
  const ranges = noteRanges(cue.target);
  const text = maskNotes(cue.target, ranges).replace(/\n/g, ' ');
  const before = [0];
  for (let i = 0; i < text.length; i++) before.push(before[i] + (SPEECH.test(text[i]) ? 1 : 0));
  const turns = turnStarts(cue.target, ranges);
  // A speaker change also cuts the sentence: the segmenter does not cut before a dash
  // («coming? - Yes.» is a single sentence for Unicode: the dash «continues» the phrase).
  const sents: Seg[] = [];
  for (const s of segmentSentences(text, lang)) {
    let a = s.start;
    for (const p of turns) if (p > a && p < s.end) { sents.push({ start: a, end: p, text: text.slice(a, p) }); a = p; }
    sents.push({ start: a, end: s.end, text: text.slice(a, s.end) });
  }
  return { cue, text, sents: sents.filter((s) => SPEECH.test(s.text)), turns, before };
}

const firstSpeech = (l: Line, from = 0) => { const k = l.text.slice(from).search(SPEECH); return k < 0 ? l.text.length : from + k; };
/** Turn (speaker) at a position: how many speaker changes come before it. */
const turnAt = (l: Line, pos: number) => l.turns.filter((p) => p <= pos).length;
/** The line opens with another speaker (dash or name before its first word). */
const opensTurn = (l: Line) => turnAt(l, firstSpeech(l)) > 0;
const startsLower = (l: Line) => /\p{Ll}/u.test(l.text[firstSpeech(l)] ?? '');
const startsWithEllipsis = (l: Line) => ELLIPSIS_START.test(l.text);

/** `a` continues in `b` (the next line). `fromB`: the word is in `b` (backwards). */
function continues(a: Line, b: Line, gap: number, fromB: boolean): boolean {
  if (!a.sents.length || !b.sents.length || opensTurn(b)) return false;
  const tail = a.text.trimEnd();
  if (ELLIPSIS_END.test(tail)) return gap <= MAX_GAP_ELLIPSIS_S && (startsWithEllipsis(b) || startsLower(b));
  if (TERMINAL.test(tail) || gap > MAX_GAP_S) return false;
  return !fromB || startsLower(b) || startsWithEllipsis(b);
}

interface Part { l: Line; line: number; start: number; end: number }

/**
 * @param offset position (in characters) of the word inside the text of line `line`.
 */
export function contextSentence(cues: readonly ContextCue[], line: number, offset: number, lang = 'en'): ContextSentence {
  const cue = cues[line];
  if (!cue) return { text: '', lines: [] };
  const L = lineOf(cue, lang);
  const sents = L.sents;
  if (!sents.length) return { text: '', lines: [] };
  let i = 0;
  sents.forEach((s, k) => { if (s.start <= offset) i = k; });
  const turnOf = (k: number) => turnAt(L, firstSpeech(L, sents[k].start));
  let first = i, last = i;
  // 2 · too short: with its neighbour of the same line and speaker
  if (wordCount(sents[i].text, lang) < MIN_WORDS) {
    if (i > 0 && turnOf(i - 1) === turnOf(i)) first = i - 1;
    else if (i < sents.length - 1 && turnOf(i + 1) === turnOf(i)) last = i + 1;
  }
  let parts: Part[] = [{ l: L, line, start: sents[first].start, end: sents[last].end }];
  // 3 · cut across lines (only by the line's edges)
  const nextCue = cues[line + 1], prevCue = cues[line - 1];
  const N = nextCue && last === sents.length - 1 ? lineOf(nextCue, lang) : null;
  const P = prevCue && first === 0 ? lineOf(prevCue, lang) : null;
  if (N && continues(L, N, nextCue.start - cue.end, false)) {
    parts.push({ l: N, line: line + 1, start: N.sents[0].start, end: N.sents[0].end });
  } else if (P && continues(P, L, cue.start - prevCue.end, true)) {
    const ps = P.sents[P.sents.length - 1];
    parts.unshift({ l: P, line: line - 1, start: ps.start, end: ps.end });
  }

  // 4 · word cap
  const own = () => parts.find((p) => p.l === L)!;
  const textOf = (ps: Part[]) => ps.map((p, k) => {
    const s = tidy(p.l.text.slice(p.start, p.end));
    return k > 0 ? s.replace(ELLIPSIS_START, '') : s;
  }).filter(Boolean).join(' ');
  let cutStart = false, cutEnd = false;
  if (wordCount(textOf(parts), lang) > MAX_WORDS && parts.length > 1) parts = [own()];
  if (wordCount(textOf(parts), lang) > MAX_WORDS && first !== last) parts = [{ l: L, line, start: sents[i].start, end: sents[i].end }];
  if (wordCount(textOf(parts), lang) > MAX_WORDS) {
    const p = parts[0];
    const r = trimAround(L.text, p.start, p.end, offset, lang);
    cutStart = r.start > firstSpeech(L, p.start);
    cutEnd = L.before[r.end] < L.before[p.end];
    parts = [{ ...p, start: r.start, end: r.end }];
  }

  const body = textOf(parts);
  const text = `${cutStart ? '… ' : ''}${body}${cutEnd ? ' …' : ''}`;
  const timeAt = (p: Part, pos: number) => {
    const total = p.l.before[p.l.text.length];
    return total ? p.l.cue.start + (p.l.cue.end - p.l.cue.start) * (p.l.before[pos] / total) : p.l.cue.start;
  };
  const a = parts[0], b = parts[parts.length - 1];
  return { text, lines: parts.map((p) => p.line), span: { start: round(timeAt(a, a.start)), end: round(timeAt(b, b.end)) } };
}

/** Trim of a long sentence around `offset`: by commas / semicolons; if not enough, MAX_WORDS centred words. */
function trimAround(text: string, start: number, end: number, offset: number, lang: string): { start: number; end: number } {
  const fits = (a: number, b: number) => wordCount(text.slice(a, b), lang) <= MAX_WORDS;
  // Clauses: cuts after , ; : — – (and their full-width equivalents).
  const cuts = [start];
  for (const m of text.slice(start, end).matchAll(/[,;:—–]\s+|[、，；：]/gu)) cuts.push(start + m.index + m[0].length);
  cuts.push(end);
  let k = 0;
  for (let c = 0; c < cuts.length - 1; c++) if (cuts[c] <= offset) k = c;
  let lo = k, hi = k + 1;
  if (fits(cuts[lo], cuts[hi])) {
    for (let grew = true; grew;) {
      grew = false;
      if (hi < cuts.length - 1 && fits(cuts[lo], cuts[hi + 1])) { hi++; grew = true; }
      else if (lo > 0 && fits(cuts[lo - 1], cuts[hi])) { lo--; grew = true; }
    }
    return { start: cuts[lo], end: trimEndPunct(text, cuts[lo], cuts[hi]) };
  }
  // A single huge clause: a word window centred on the word.
  const words: { start: number; end: number }[] = [];
  let at = cuts[k];
  for (const w of segmentWords(text.slice(cuts[k], cuts[k + 1]), lang)) {
    if (SPEECH.test(w)) words.push({ start: at, end: at + w.length });
    at += w.length;
  }
  let j = 0;
  words.forEach((w, n) => { if (w.start <= offset) j = n; });
  const from = Math.max(0, Math.min(j - Math.floor(MAX_WORDS / 2), words.length - MAX_WORDS));
  const to = Math.min(words.length, from + MAX_WORDS) - 1;
  return { start: words[from].start, end: words[to].end };
}

/** Without the comma or semicolon of the cut at the end of the chunk. */
function trimEndPunct(text: string, start: number, end: number): number {
  let e = end;
  while (e > start && /[\s,;:—–、，；：]/u.test(text[e - 1])) e--;
  return e;
}