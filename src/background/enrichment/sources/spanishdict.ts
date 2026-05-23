/**
 * SpanishDict scraper — VIP source.
 *
 * `spanishdict.com` ships translations + headword + audio in a single
 * page. Their site is a Next.js app but the dictionary data is
 * rendered on the server as plain HTML — we just have to lock onto the
 * stable structural markers, not the hashed CSS class names.
 *
 * Pattern verified live 2026-05:
 *
 *   <tr class="..." data-testid="headword-and-quickdef-audio-row">
 *     <td lang="en" class="source ...">
 *       <a href="/translate/<word>" class="...">excuse me</a>
 *     </td>
 *     <td lang="es" class="quickdef ...">
 *       <a href="/translate/<word>" class="...">perdón</a>
 *     </td>
 *   </tr>
 *
 * Source rows render the source-language phrase, target rows render
 * the translation. We pair them sequentially (the markup guarantees
 * source-then-target order). Short pairs (≤ 4 words on the source
 * side) get classified as headword translations; longer pairs become
 * example phrases.
 *
 * NOTE: previous draft tried to read `__NEXT_DATA__` JSON which the
 * site no longer ships. Audit run on 2026-05-22 confirmed the markup
 * pattern above is the live one.
 */

import { fetchHtml } from '../fetcher';
import { stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

function extractAnchorText(td: string): string {
  const a = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(td);
  return a ? stripHtml(a[1]) : stripHtml(td);
}

export const spanishDictSource: EnrichmentSource = {
  id: 'spanishDict',
  label: 'SpanishDict',
  async enrich(token, ctx): Promise<SourcePartial> {
    const src = (ctx.sourceLang || 'en').slice(0, 2);
    const tgt = (ctx.targetLang || 'es').slice(0, 2);
    if (!((src === 'en' && tgt === 'es') || (src === 'es' && tgt === 'en'))) return {};

    const slug = encodeURIComponent(token.trim().toLowerCase());
    const url = `https://www.spanishdict.com/translate/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!html) return {};

    // Capture every <td lang="..." class="source|quickdef ...">...</td>
    // along with its lang attr to know which side it's on.
    const tdRe =
      /<td\b[^>]*\blang\s*=\s*["']([a-z]{2})["'][^>]*\bclass\s*=\s*["'][^"']*\b(source|quickdef)\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;

    interface Cell { lang: string; kind: 'source' | 'quickdef'; text: string }
    const cells: Cell[] = [];
    let m: RegExpExecArray | null;
    while ((m = tdRe.exec(html))) {
      const txt = extractAnchorText(m[3]);
      if (!txt) continue;
      cells.push({ lang: m[1], kind: m[2] as 'source' | 'quickdef', text: txt });
    }
    if (cells.length === 0) return {};

    // Pair consecutive source -> quickdef cells.
    const translations = new Set<string>();
    const examples: Array<{ text: string; translation?: string }> = [];

    for (let i = 0; i < cells.length - 1; i += 1) {
      const a = cells[i];
      const b = cells[i + 1];
      if (a.kind !== 'source' || b.kind !== 'quickdef') continue;
      const sourceText = src === a.lang ? a.text : b.text;
      const targetText = tgt === b.lang ? b.text : a.text;
      if (!sourceText || !targetText) continue;
      const wordCount = sourceText.split(/\s+/).length;
      if (wordCount <= 4 && targetText.length < 60) {
        translations.add(targetText);
      } else if (sourceText.length > 8 && sourceText.length < 220) {
        examples.push({ text: sourceText, translation: targetText });
      }
      if (translations.size + examples.length >= 12) break;
    }

    const partial: SourcePartial = {};
    if (translations.size) partial.translations = Array.from(translations).slice(0, 6);
    if (examples.length) partial.examples = examples.slice(0, 6);
    return partial;
  },
};
