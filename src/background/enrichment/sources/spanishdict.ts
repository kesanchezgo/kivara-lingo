/**
 * SpanishDict scraper — VIP source.
 *
 * `spanishdict.com` ships translations + example sentences + audio in
 * a single page. Pattern based on `Antberro/SpanishDict-API` and
 * `librehat/sdapi`.
 *
 * SpanishDict embeds its data inside a `<script id="__NEXT_DATA__">`
 * JSON blob. We grab that JSON and read translations + example pairs
 * directly — far more reliable than HTML scraping the rendered page.
 */

import { fetchHtml } from '../fetcher';
import { decodeEntities } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

interface NextDataExample {
  textEn?: string;
  textEs?: string;
}

interface NextDataNeodict {
  partOfSpeech?: { name?: string };
  senses?: Array<{
    translations?: Array<{ translation?: string; examples?: NextDataExample[] }>;
    examples?: NextDataExample[];
  }>;
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

    // Pull __NEXT_DATA__ JSON.
    const m = /<script[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!m) return {};
    let json: unknown;
    try {
      json = JSON.parse(decodeEntities(m[1]));
    } catch {
      return {};
    }

    // Walk the structure to find the neodict entries. The path is
    // typically `props.pageProps.dictionaryRequest.neodict[]`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = (json as any)?.props?.pageProps?.dictionaryRequest;
    const neodict: NextDataNeodict[] = Array.isArray(root?.neodict) ? root.neodict : [];
    if (neodict.length === 0) return {};

    const translations = new Set<string>();
    const examples: Array<{ text: string; translation?: string }> = [];

    for (const entry of neodict) {
      for (const sense of entry.senses ?? []) {
        for (const tr of sense.translations ?? []) {
          if (tr.translation) {
            const t = String(tr.translation).trim();
            if (t && t.length < 60) translations.add(t);
          }
          for (const ex of tr.examples ?? []) {
            const txt = (src === 'en' ? ex.textEn : ex.textEs) ?? '';
            const tr2 = (src === 'en' ? ex.textEs : ex.textEn) ?? '';
            if (txt && txt.length > 8 && txt.length < 220) {
              examples.push({ text: txt, translation: tr2 || undefined });
            }
            if (examples.length >= 6) break;
          }
        }
        for (const ex of sense.examples ?? []) {
          const txt = (src === 'en' ? ex.textEn : ex.textEs) ?? '';
          const tr2 = (src === 'en' ? ex.textEs : ex.textEn) ?? '';
          if (txt && txt.length > 8 && txt.length < 220) {
            examples.push({ text: txt, translation: tr2 || undefined });
          }
          if (examples.length >= 6) break;
        }
      }
    }

    const partial: SourcePartial = {};
    if (translations.size) partial.translations = Array.from(translations).slice(0, 6);
    if (examples.length) partial.examples = examples.slice(0, 6);
    return partial;
  },
};
