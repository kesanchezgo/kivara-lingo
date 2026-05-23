/**
 * Reverso Context — VIP source.
 *
 * Reverso ships translations of source-language sentences pulled from
 * real-world parallel corpora (subtitles, news, books).
 *
 * Verified live 2026-05: the JSON `bst-query-service` endpoint accepts
 * any well-formed POST but returns an empty `list: []` when called
 * cross-origin without a session cookie. The HTML page, by contrast,
 * embeds 13+ example pairs as plain markup that we can scrape:
 *
 *   GET https://context.reverso.net/translation/<src>-<tgt>/<word>
 *
 *   <div class="example">
 *     <div class="src ltr">… source sentence …</div>
 *     <div class="trg ltr">… translated sentence …</div>
 *   </div>
 *
 * The page also embeds a `var response = { firstSrcExample, firstTrgExample,
 * comment }` JS literal at the top with the headword's primary
 * translation — we extract `comment` for the translations[] slot.
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

const LANG_MAP: Record<string, string> = {
  en: 'english',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  ru: 'russian',
  ja: 'japanese',
  zh: 'chinese',
  ko: 'korean',
};

export const reversoSource: EnrichmentSource = {
  id: 'reverso',
  label: 'Reverso',
  async enrich(token, ctx): Promise<SourcePartial> {
    const src = LANG_MAP[(ctx.sourceLang || 'en').slice(0, 2)];
    const tgt = LANG_MAP[(ctx.targetLang || 'es').slice(0, 2)];
    if (!src || !tgt || src === tgt) return {};

    const slug = encodeURIComponent(token.trim());
    const url = `https://context.reverso.net/translation/${src}-${tgt}/${slug}`;
    const html = await fetchHtml(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Referer: 'https://context.reverso.net/',
      },
    });
    if (!html) return {};

    const partial: SourcePartial = {};

    // Extract the inline `var response = { ... }` block with the
    // headword's primary translation comment.
    const responseMatch = /var\s+response\s*=\s*\{([\s\S]*?)\};/i.exec(html);
    if (responseMatch) {
      const body = responseMatch[1];
      const commentMatch = /comment:\s*"([^"]*)"/i.exec(body);
      if (commentMatch && commentMatch[1]) {
        const translations = commentMatch[1]
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter((t) => t && t.length < 60);
        if (translations.length) {
          partial.translations = Array.from(new Set(translations)).slice(0, 6);
        }
      }
    }

    // Each example block has `<div class="src ltr">…</div>` + `<div
    // class="trg ltr">…</div>` as siblings.
    const exampleBlocks = extractByClass(html, 'example', 'div');
    const examples: Array<{ text: string; translation?: string }> = [];
    for (const block of exampleBlocks) {
      const srcs = [
        ...extractByClass(block, 'src', 'div'),
        ...extractByClass(block, 'src', 'span'),
      ];
      const trgs = [
        ...extractByClass(block, 'trg', 'div'),
        ...extractByClass(block, 'trg', 'span'),
      ];
      if (!srcs.length || !trgs.length) continue;
      const sourceText = stripHtml(srcs[0]);
      const targetText = stripHtml(trgs[0]);
      if (sourceText.length > 8 && sourceText.length < 220) {
        examples.push({ text: sourceText, translation: targetText || undefined });
      }
      if (examples.length >= 6) break;
    }
    if (examples.length) partial.examples = examples;

    return partial;
  },
};
