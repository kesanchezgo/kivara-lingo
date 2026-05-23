/**
 * Wiktionary REST API source — Standard tier.
 *
 * Wiktionary's official REST endpoint returns clean JSON for any
 * lemma, including phrasal verbs ("look up"), idioms ("kick the
 * bucket") and compound MWEs ("big deal") — exactly the gaps that
 * scrape-based commercial dictionaries (Cambridge / Oxford / Longman)
 * miss for multi-word expressions.
 *
 *   GET https://en.wiktionary.org/api/rest_v1/page/definition/<slug>
 *
 * Response shape (verified live 2026-05):
 *   {
 *     "en": [
 *       {
 *         "partOfSpeech": "Verb",
 *         "language": "English",
 *         "definitions": [
 *           {
 *             "definition": "<HTML span> To die.",
 *             "examples": ["The old horse finally kicked the bucket."]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Slug format:
 *   - Single word:        `apple`
 *   - Multi-word phrase:  `look_up`, `kick_the_bucket`, `big_deal`
 *   - Spaces become underscores; capitals are case-sensitive (lower).
 *
 * License: text-and-data CC-BY-SA, no key, no rate limit (Wikimedia
 * tolerates personal-use queries).
 */

import { fetchJson } from '../fetcher';
import { stripHtml } from '../html-utils';
import type { EnrichmentSource, SourcePartial } from '../types';

interface WiktDefinition {
  definition?: string;
  examples?: string[];
  parsedExamples?: Array<{ example?: string }>;
}

interface WiktEntry {
  partOfSpeech?: string;
  language?: string;
  definitions?: WiktDefinition[];
}

type WiktResponse = Record<string, WiktEntry[]>;

export const wiktionarySource: EnrichmentSource = {
  id: 'wiktionary',
  label: 'Wiktionary',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {}; // EN only for now; ES path uses kty-es-es pack

    // Wiktionary slug: spaces → underscores. Case-sensitive — Wiktionary
    // pages are typically stored at the lowercased lemma.
    const slug = encodeURIComponent(token.trim().replace(/\s+/g, '_'));
    const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${slug}`;
    const data = await fetchJson<WiktResponse>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Accept: 'application/json',
        // Wikimedia asks for a User-Agent that identifies the app.
        // Service worker fetches will use Chrome's UA which Wikimedia
        // tolerates; we also include a custom marker.
        'Api-User-Agent': 'KivaraLingo/1.0 (chrome-extension)',
      },
    });
    if (!data) return {};

    // Iterate language buckets — for English-only sources the bucket
    // is `en`, but Wiktionary returns multiple language sections so a
    // word like "apple" can also have French/Spanish entries we want
    // to ignore.
    const englishEntries = data.en || [];
    if (!englishEntries.length) return {};

    const partial: SourcePartial = {};
    const definitions: string[] = [];
    const examples: Array<{ text: string }> = [];

    for (const entry of englishEntries) {
      if (entry.language !== 'English') continue;
      for (const def of entry.definitions || []) {
        const cleanDef = stripHtml(def.definition || '').trim();
        if (cleanDef && cleanDef.length > 6 && cleanDef.length < 400) {
          definitions.push(cleanDef);
        }
        for (const ex of def.examples || []) {
          const cleanEx = stripHtml(ex || '').trim();
          if (cleanEx.length > 8 && cleanEx.length < 220) {
            examples.push({ text: cleanEx });
          }
        }
      }
    }

    if (definitions.length) partial.definitions = definitions.slice(0, 5);
    if (examples.length) partial.examples = examples.slice(0, 5);
    return partial;
  },
};
