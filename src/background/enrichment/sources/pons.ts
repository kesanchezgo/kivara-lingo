/**
 * PONS English-Spanish dictionary scraper — VIP source.
 *
 * Validated by raw audit + parser snapshots in docs/sources/pons.md.
 * PONS is rich but mixed: compact lexical translations, phrase patterns
 * and aligned examples are all in the same page. This parser deliberately
 * separates them so examples never pollute the main `bilingual` gloss.
 */

import { fetchHtml } from '../fetcher';
import { expandSlashAlternatives, stripHtml } from '../html-utils';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://en.pons.com';

function slug(token: string): string {
  return encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
}

function cleanText(raw?: string | null): string {
  if (!raw) return '';
  return stripHtml(stripHtml(raw))
    .replace(/\s+/g, ' ')
    .replace(/\b(formal language|formal|informal|form|inf|fam|pej)\b/gi, ' ')
    .replace(/\b(Mexican Spanish|European Spanish|Spain|Latin America|Am|Brit)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(block: string, name: string): string | null {
  // PONS embeds raw HTML tags inside data-* values, so a normal <button[^>]*>
  // slice stops too early. The caller passes the full button block and this
  // stops at the next known attribute boundary instead of the next `>`.
  const re = new RegExp(`${name}="([\\s\\S]*?)"(?=\\s+(?:data-|class=|title=|aria-|id=)|\\s*>|>)`, 'i');
  return re.exec(block)?.[1] ?? null;
}

function isSourceSentence(text: string): boolean {
  const t = text.toLowerCase();
  if (/[.!?¿¡]/.test(t)) return true;
  if (/\b(i|you|he|she|we|they|it|do|does|did|what|when|where|why|how|if|this|that|there|have|has|had|was|were|is|are)\b/.test(t)) return true;
  return text.split(/\s+/).length > 6;
}

function splitAlternatives(text: string): string[] {
  return text
    .replace(/\s+or\s+/gi, ' | ')
    .replace(/\s+and\s+/gi, ' | ')
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanGlossCandidate(text: string): string[] {
  const out: string[] = [];
  for (const raw of splitAlternatives(text)) {
    let t = raw
      .replace(/\b(m|f|mf|mpl|fpl|sg|pl)\b\.?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) continue;
    // Drop example sentences and conjugated phrase translations.
    if (/[.!?¿¡]/.test(t)) continue;
    if (t.length > 64) continue;
    if (/^(el|la|los|las|un|una|unos|unas|al|del|me|te|se|nos|le|les|lo|ya|no|si|como|cuando|que|qué)\b/i.test(t)) continue;
    if (/^(ser|hacerle|regalarle|podría|podria)\b/i.test(t)) continue;
    if (/\balguien\b/i.test(t)) continue;
    if (/\b(dio|di|dieron|dame|dale|dales|quieres|quiero|quiere|tengo|tiene|tenía|había|lograste|siento|está|estuvo|han sido|dijo|pasar)\b/i.test(t)) continue;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length > 3) continue;
    out.push(t);
  }
  return out;
}

function sourceContainsToken(source: string, token: string): boolean {
  const compactSource = source.toLowerCase().replace(/\s+/g, ' ').trim();
  const compactToken = token.toLowerCase().replace(/\s+/g, ' ').trim();
  if (compactSource === compactToken) return true;
  return new RegExp(`\\b${compactToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(compactSource);
}

function isUsefulExample(source: string, target: string, token: string): boolean {
  if (!sourceContainsToken(source, token)) return false;
  if (!isSourceSentence(source)) return false;
  if (target.length < 8 || target.length > 220) return false;
  return /[.!?¿¡]|\b(i|you|he|she|we|they|it|do|does|did|what|if|this|that|there)\b/i.test(source);
}

function normalizeCollocations(source: string, token: string): string[] {
  const clean = source
    .replace(/\s+/g, ' ')
    .replace(/\b(sb|sth)\b/gi, 'someone')
    .replace(/\s*,\s*/g, ' / ')
    .trim();
  if (!sourceContainsToken(clean, token)) return [];
  if (clean.toLowerCase() === token.toLowerCase()) return [];
  if (isSourceSentence(clean)) return [];
  if (clean.length > 70) return [];
  // PONS packs variants with slashes ("give tip/money/alms"). Expand with
  // the same single-word safety rule as Longman: multi-word alternatives
  // stay out rather than publish a guessed split. Verified live 2026-09-06
  // on `give` (slash-packed translation rows).
  return expandSlashAlternatives(clean);
}

function uniquePush(arr: string[], value: string, max = 20): void {
  const v = value.trim();
  if (!v) return;
  if (!arr.some((x) => x.toLowerCase() === v.toLowerCase())) arr.push(v);
  if (arr.length > max) arr.length = max;
}

export const ponsSource: EnrichmentSource = {
  id: 'pons',
  label: 'PONS',
  async enrich(token, ctx: EnrichmentContext): Promise<SourcePartial> {
    if ((ctx.sourceLang || 'en').slice(0, 2) !== 'en' || (ctx.targetLang || 'es').slice(0, 2) !== 'es') {
      return {};
    }

    const html = await fetchHtml(`${BASE}/translate/english-spanish/${slug(token)}`, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      },
    });
    if (!html) return {};

    const allowTranslations = !/\s/.test(token.trim());
    const translations: string[] = [];
    const examples: Array<{ text: string; translation?: string }> = [];
    const collocations: string[] = [];

    const blocks = html.match(/<button[\s\S]*?add-to-vocabulary-trainer[\s\S]*?<\/button>/gi) ?? [];
    for (const block of blocks) {
      const source = cleanText(attr(block, 'data-translation-source'));
      const target = cleanText(attr(block, 'data-translation-target'));
      if (!source || !target) continue;

      if (isUsefulExample(source, target, token)) {
        if (!examples.some((ex) => ex.text.toLowerCase() === source.toLowerCase())) {
          examples.push({ text: source, translation: target });
        }
        continue;
      }

      for (const collocation of normalizeCollocations(source, token)) {
        uniquePush(collocations, collocation, 12);
      }

      // Main bilingual gloss: only compact source rows that refer to the
      // headword or a short headword phrase, never sentence examples.
      if (allowTranslations && sourceContainsToken(source, token) && !isSourceSentence(source)) {
        for (const gloss of cleanGlossCandidate(target)) uniquePush(translations, gloss, 10);
      }
    }

    const partial: SourcePartial = {};
    if (translations.length) partial.translations = translations.slice(0, 6);
    if (examples.length) partial.examples = examples.slice(0, 6);
    if (collocations.length) partial.collocations = collocations.slice(0, 10);
    return partial;
  },
};
