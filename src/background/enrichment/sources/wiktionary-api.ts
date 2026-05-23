/**
 * freedictionaryapi.com — Standard-tier source.
 *
 * Modern, actively-maintained Wiktionary REST mirror that handles
 * MULTI-WORD phrases that the older `api.dictionaryapi.dev` and even
 * the official Wikimedia REST endpoint don't index well.
 *
 * Verified live 2026-05-23 returning rich data for:
 *   - "kick the bucket" → 18+ sinonimos (kick it, bite the dust,
 *     buy the farm, assume room temperature, ...)
 *   - "look up" → IPA + synonyms + examples
 *   - "big deal" → 2 senses (noun + interjection) with synonyms
 *   - "lit" → 8 entries covering all senses
 *
 * Endpoint: `https://freedictionaryapi.com/api/v1/entries/<lang>/<word>`
 * Words use spaces or %20 (NOT underscores). No token, CC-BY-SA.
 *
 * Response shape:
 *   {
 *     word: "kick the bucket",
 *     entries: [
 *       {
 *         partOfSpeech: "verb",
 *         pronunciations: [{ type: "ipa", text: "/ˈkɪk ðə ˈbʌkɪt/", tags }],
 *         senses: [
 *           {
 *             definition: "(idiomatic, euphemistic) To die.",
 *             examples: ["The old horse finally kicked the bucket."],
 *             synonyms: ["kick it", "bite the dust", ...],
 *             antonyms: []
 *           }
 *         ],
 *         etymology: "From the practice of ..."
 *       }
 *     ]
 *   }
 */
import { fetchJson } from '../fetcher';
import type { EnrichmentSource, SourcePartial } from '../types';

interface WiktApiSense {
  definition?: string;
  examples?: string[];
  synonyms?: string[];
  antonyms?: string[];
}

interface WiktApiPronun {
  type?: string;
  text?: string;
  audio?: string;
  tags?: string[];
}

interface WiktApiEntry {
  partOfSpeech?: string;
  pronunciations?: WiktApiPronun[];
  senses?: WiktApiSense[];
  etymology?: { text?: string };
}

interface WiktApiResponse {
  word?: string;
  entries?: WiktApiEntry[];
}

export const wiktionaryApiSource: EnrichmentSource = {
  id: 'wiktionaryApi',
  label: 'WiktionaryAPI',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};
    // freedictionaryapi.com expects spaces (or %20) for multi-word
    // queries; underscores return empty `entries: []`.
    const slug = encodeURIComponent(token.trim());
    const url = `https://freedictionaryapi.com/api/v1/entries/${lang}/${slug}`;
    const data = await fetchJson<WiktApiResponse>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': 'KivaraLingo/1.0 (chrome-extension)',
      },
    });
    if (!data?.entries?.length) return {};

    const partial: SourcePartial = {};
    const definitions = new Set<string>();
    const examples: Array<{ text: string }> = [];
    const synonyms = new Set<string>();
    const antonyms = new Set<string>();
    const audio: Array<{ url: string; accent?: string }> = [];
    let phonetic: string | undefined;
    let etymology: string | undefined;

    for (const entry of data.entries) {
      // IPA — prefer Received Pronunciation (UK) then anything.
      for (const p of entry.pronunciations ?? []) {
        if (p.type === 'ipa' && p.text) {
          if (!phonetic) phonetic = p.text;
          // British / RP wins if we already had something neutral.
          else if ((p.tags ?? []).some((t) => /Received Pronunciation|UK|British/i.test(t))) {
            phonetic = p.text;
          }
        }
        if (p.audio) {
          const accent = (p.tags ?? []).find((t) => /US|UK|AU|CA/i.test(t));
          audio.push({ url: p.audio, accent });
        }
      }
      // Etymology — first non-empty wins.
      if (!etymology && entry.etymology?.text) {
        const text = entry.etymology.text.trim();
        if (text.length > 20) {
          etymology = text.length > 360 ? text.slice(0, 357) + '…' : text;
        }
      }
      // Senses → defs + examples + syn/ant
      for (const s of entry.senses ?? []) {
        if (s.definition && s.definition.length > 6 && s.definition.length < 400) {
          definitions.add(s.definition);
        }
        for (const ex of s.examples ?? []) {
          if (ex && ex.length > 8 && ex.length < 220) examples.push({ text: ex });
        }
        for (const w of s.synonyms ?? []) synonyms.add(w);
        for (const w of s.antonyms ?? []) antonyms.add(w);
      }
    }

    if (definitions.size) partial.definitions = Array.from(definitions).slice(0, 6);
    if (examples.length) partial.examples = examples.slice(0, 6);
    if (synonyms.size) partial.synonyms = Array.from(synonyms).slice(0, 16);
    if (antonyms.size) partial.antonyms = Array.from(antonyms).slice(0, 10);
    if (audio.length) partial.audio = audio.slice(0, 4);
    if (phonetic) partial.phonetic = phonetic;
    if (etymology) partial.etymology = etymology;
    return partial;
  },
};
