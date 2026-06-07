/**
 * bab.la English-Spanish dictionary scraper — VIP source.
 *
 * Validated by raw audit + parser snapshots in docs/sources/babla.md.
 * bab.la is rich (translations, Oxford-powered sections, examples,
 * idioms, phrasals) but mixes compact dictionary entries with corpus
 * sentences. This parser keeps compact glosses separate from examples.
 */

import { fetchHtml } from '../fetcher';
import { stripHtml } from '../html-utils';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://en.bab.la';

function slug(token: string): string {
  return encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
}

function cleanText(raw?: string | null): string {
  if (!raw) return '';
  return stripHtml(stripHtml(raw))
    .replace(/\b(volume_up|open_in_new|warning|request revision|link to source)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(formal|informal|slang|dated|colloquial|masculine|feminine|verb|noun|adjective|adverb)\b/gi, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniquePush(arr: string[], value: string, max = 20): void {
  const v = value.trim();
  if (!v) return;
  if (!arr.some((x) => x.toLowerCase() === v.toLowerCase())) arr.push(v);
  if (arr.length > max) arr.length = max;
}

function sourceContainsToken(source: string, token: string): boolean {
  const s = source.toLowerCase().replace(/\s+/g, ' ').trim();
  const t = token.toLowerCase().replace(/\s+/g, ' ').trim();
  if (s === t) return true;
  return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(s);
}

function isSentence(text: string): boolean {
  if (/[.!?¿¡]/.test(text)) return true;
  if (/\b(i|you|he|she|we|they|it|do|does|did|what|when|where|why|how|if|this|that|there|have|has|had|was|were|is|are|will|would|can|could)\b/i.test(text)) return true;
  return text.split(/\s+/).length > 7;
}

function cleanGloss(raw: string): string[] {
  const bits = raw
    .replace(/\s+or\s+/gi, ' | ')
    .replace(/\s*,\s*/g, ' | ')
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let bit of bits) {
    bit = bit
      .replace(/\b(vb|adj|adv|nm|nf|m|f|pl|sg)\b\.?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!bit || bit === '—' || bit === 'volume_up') continue;
    if (/^ácil$/i.test(bit)) continue;
    if (/[.!?¿¡]/.test(bit)) continue;
    if (bit.length > 64) continue;
    if (/^(el|la|los|las|un|una|unos|unas|al|del|me|te|se|nos|le|les|lo|ya|no|si|como|cuando|que|qué)\b/i.test(bit)) continue;
    if (/\b(dio|di|dieron|dame|dale|quieres|quiero|quiere|tengo|tiene|tenía|había|lograste|siento|está|estuvo|han sido|dijo|pasar)\b/i.test(bit)) continue;
    const words = bit.split(/\s+/).filter(Boolean);
    if (words.length > 4) continue;
    out.push(bit);
  }
  return out;
}

function extractAudio(html: string): Array<{ url: string; accent?: string }> {
  const out: Array<{ url: string; accent?: string }> = [];
  const re = /babTTS\('([^']+\.mp3[^']*)'\s*,\s*'([^']*)'\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 4) {
    const url = m[1];
    if (/\/sounds\/en\//.test(url) && !out.some((a) => a.url === url)) out.push({ url });
  }
  return out;
}

export const bablaSource: EnrichmentSource = {
  id: 'babla',
  label: 'bab.la',
  async enrich(token, ctx: EnrichmentContext): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2) !== 'en' || (ctx.targetLang || 'es').slice(0, 2) !== 'es') {
      return {};
    }

    const html = await fetchHtml(`${BASE}/dictionary/english-spanish/${slug(token)}`, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
        // Browser-like headers returned Cloudflare 403 in raw audit. This
        // crawler-compatible UA returns stable static dictionary HTML.
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    });
    if (!html) return {};

    const allowTranslations = !/\s/.test(token.trim());
    const translations: string[] = [];
    const examples: Array<{ text: string; translation?: string }> = [];
    const collocations: string[] = [];
    const audio = extractAudio(html);

    // Quick-result top translation. Good signal for primary gloss.
    if (allowTranslations) {
      for (const m of html.matchAll(/<span\s+class=("|')babQuickResult\1[^>]*>([\s\S]*?)<\/span>/gi)) {
        for (const gloss of cleanGloss(cleanText(m[2]))) uniquePush(translations, gloss, 10);
      }
    }

    // Dictionary entries: compact source/target rows.
    const entries = html.match(/<div\s+class=("|')dict-entry\1[\s\S]*?(?=<div\s+class=("|')dict-entry\2|<div\s+class=("|')sense-group\3|<h[23]\b|$)/gi) ?? [];
    for (const entry of entries) {
      const source = cleanText(/<div\s+class=("|')dict-source\1[^>]*>([\s\S]*?)<\/div>/i.exec(entry)?.[2]);
      const target = cleanText(/<div\s+class=("|')dict-result\1[^>]*>([\s\S]*?)<\/div>/i.exec(entry)?.[2]);
      if (!source || !target) continue;
      if (allowTranslations && sourceContainsToken(source, token) && !isSentence(source)) {
        for (const gloss of cleanGloss(target)) uniquePush(translations, gloss, 10);
        if (source.toLowerCase() !== token.toLowerCase() && source.length < 70 && !/\(also:/i.test(source)) uniquePush(collocations, source, 12);
      }
    }

    // Aligned corpus examples. Keep them in examples only.
    const exBlocks = html.match(/<div\s+class=("|')dict-example\1[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];
    for (const block of exBlocks) {
      const source = cleanText(/<div\s+class=("|')dict-source\1[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[2]);
      const target = cleanText(/<div\s+class=("|')dict-result\1[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[2]);
      if (!source || !target) continue;
      if (sourceContainsToken(source, token) && source.length < 240 && target.length < 240) {
        if (!examples.some((e) => e.text.toLowerCase() === source.toLowerCase())) {
          examples.push({ text: source, translation: target });
        }
      }
    }

    const partial: SourcePartial = {};
    if (translations.length) partial.translations = translations.slice(0, 6);
    if (examples.length) partial.examples = examples.slice(0, 6);
    if (collocations.length) partial.collocations = collocations.slice(0, 10);
    if (audio.length) partial.audio = audio.slice(0, 2);
    return partial;
  },
};
