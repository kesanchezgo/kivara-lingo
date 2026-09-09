/**
 * dict.cc English-Spanish scraper — VIP secondary bilingual source.
 *
 * Validated in docs/sources/dictcc.md. dict.cc exposes a compact JS array
 * (`c1Arr` Spanish, `c2Arr` English) even when the visible table is small.
 * It is useful as a secondary fallback for concise bilingual rows and some
 * idioms, but it must not outrank PONS/bab.la/Cambridge.
 */

import { fetchHtml } from '../fetcher';
import { expandSlashAlternatives, stripHtml } from '../html-utils';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://enes.dict.cc/';

function norm(text?: string | null): string {
  return stripHtml(text ?? '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsStringArray(html: string, name: string): string[] {
  const match = new RegExp(`var\\s+${name}\\s*=\\s*new\\s+Array\\((.*?)\\);`, 's').exec(html);
  if (!match) return [];
  const body = match[1];
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(norm(m[1]));
  return out;
}

function cleanSpanish(raw: string): string {
  return norm(raw)
    .replace(/\b(algo|a-algn\/algo|a algn|algn|sth\.|sb\.|\[.*?\])\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedEnglish(raw: string): string {
  return norm(raw)
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(?:sth|sb)\.?/g, ' ')
    .replace(/\b(someone|something)\b/g, ' ')
    .replace(/\bsb\/sth\.*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * dict.cc rows as bare learner chunks (`to give advice` → `give advice`,
 * `to run away / off` → `run away` + `run off`). dict.cc rows are
 * infinitive-marked dictionary entries; the merger's anti-infinitive rule
 * would kill them all as usage notes, so the parser strips the leading
 * `to` and normalizes argument slots up front. A bare `to <headword>`
 * (`to give`) carries no collocate and stays out — it feeds translations,
 * not collocations. Slash variants expand with the same single-word
 * safety rule as Longman/PONS. Verified live 2026-09-09: `give` ships 51
 * rows, almost all `to give X` shaped.
 */
export function bareCollocationChunks(english: string, token: string): string[] {
  let text = norm(english)
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(sb|sth)\.?/gi, 'someone')
    .replace(/\bsb\/sth\.*/gi, 'someone')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  if (!text) return [];
  // Strip the infinitive marker so the chunk is a reusable bare pair.
  text = text.replace(/^to\s+/i, '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const t = token.toLowerCase().trim();
  if (text.toLowerCase() === t) return [];
  if (text.length > 80) return [];
  // A lone slot (`give someone`) or slot-only variants
  // (`run someone/someone over` before the merger's slash rule) carry no
  // lexical collocate — the merger's template guard would kill them
  // anyway, so save the round.
  const SLOT = new Set(['someone', 'somebody', 'something']);
  const isSlotWord = (w: string) =>
    SLOT.has(w) || w.split('/').filter(Boolean).every((part) => SLOT.has(part));
  const out: string[] = [];
  for (const chunk of expandSlashAlternatives(text)) {
    const rest = chunk.toLowerCase().split(/\s+/).filter((w) => w && w !== t);
    if (!rest.length) continue;
    if (rest.every(isSlotWord)) continue;
    out.push(chunk);
  }
  return out;
}

function isBadSpanish(value: string): boolean {
  if (!value || value === '—') return true;
  if (/^\[/.test(value)) return true;
  if (/[.!?¿¡]/.test(value)) return true;
  if (value.length > 64) return true;
  if (/^(déme|dame|dale|me|te|se|nos|le|les|lo|la|los|las|antes que|un montón)/i.test(value)) return true;
  if (/^ser pan comido$/i.test(value)) return false;
  if (/\b(cacharro|tartaleta|golilla|pichincha|sacar el rollo)\b/i.test(value)) return true;
  return value.split(/\s+/).filter(Boolean).length > 4;
}

function englishMatches(english: string, token: string): boolean {
  const t = token.toLowerCase().replace(/\s+/g, ' ').trim();
  const e = normalizedEnglish(english);
  if (e === t) return true;
  if (e === `to ${t}`) return true;
  // Compact transitive forms such as "to give sth." normalize to "to give".
  // Do not accept object-specific rows like "to give advice" as main gloss;
  // those become collocations instead.
  // Idiom entries: "to be a piece of cake" should feed piece of cake.
  if (t.includes(' ') && e === `to be a ${t}`) return true;
  return false;
}

function uniquePush(arr: string[], value: string, max = 8): void {
  const v = value.trim();
  if (!v || arr.some((x) => x.toLowerCase() === v.toLowerCase())) return;
  arr.push(v);
  if (arr.length > max) arr.length = max;
}

export const dictCcSource: EnrichmentSource = {
  id: 'dictCc',
  label: 'dict.cc',
  async enrich(token, ctx: EnrichmentContext): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2) !== 'en' || (ctx.targetLang || 'es').slice(0, 2) !== 'es') {
      return {};
    }
    const html = await fetchHtml(`${BASE}?s=${encodeURIComponent(token.trim())}`, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      },
    });
    if (!html) return {};

    const spanish = parseJsStringArray(html, 'c1Arr');
    const english = parseJsStringArray(html, 'c2Arr');
    const translations: string[] = [];
    const collocations: string[] = [];

    for (let i = 1; i < Math.min(spanish.length, english.length); i += 1) {
      const es = cleanSpanish(spanish[i]);
      const en = norm(english[i]);
      if (!en || !es || isBadSpanish(es)) continue;
      if (englishMatches(en, token)) {
        uniquePush(translations, es, 6);
      } else if (en.toLowerCase().includes(token.toLowerCase()) && en.length < 80) {
        // Infinitive-marked rows arrive bare (`give advice`, not
        // `to give advice`): the merger's anti-infinitive rule targets
        // usage-note shapes, and a bare dictionary row is a real chunk.
        for (const chunk of bareCollocationChunks(en, token)) uniquePush(collocations, chunk, 8);
      }
    }

    const partial: SourcePartial = {};
    if (translations.length) partial.translations = translations;
    if (collocations.length) partial.collocations = collocations;
    return partial;
  },
};
