/**
 * dict.cc English-Spanish scraper — VIP secondary bilingual source.
 *
 * Validated in docs/sources/dictcc.md. dict.cc exposes a compact JS array
 * (`c1Arr` Spanish, `c2Arr` English) even when the visible table is small.
 * It is useful as a secondary fallback for concise bilingual rows and some
 * idioms, but it must not outrank PONS/bab.la/Cambridge.
 */

import { fetchHtml } from '../fetcher';
import { stripHtml } from '../html-utils';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://enes.dict.cc/';

function norm(text?: string | null): string {
  return stripHtml(text ?? '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
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
        uniquePush(collocations, en, 8);
      }
    }

    const partial: SourcePartial = {};
    if (translations.length) partial.translations = translations;
    if (collocations.length) partial.collocations = collocations;
    return partial;
  },
};
