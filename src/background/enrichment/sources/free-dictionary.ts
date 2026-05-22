/**
 * Free Dictionary API — `dictionaryapi.dev`.
 *
 * MIT-licensed mirror of the Wiktionary structured dictionary. No token,
 * no rate limit, no signup. Returns:
 *   - phonetic + audio (Wikimedia Commons MP3 URLs)
 *   - definitions per part-of-speech
 *   - synonyms / antonyms per sense
 *   - example sentences
 *
 * This is the ONE Standard-tier API source we always consult, even with
 * VIP off, because it ships native audio for free without signup.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

interface FreeDictResponse {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{
      definition?: string;
      example?: string;
      synonyms?: string[];
      antonyms?: string[];
    }>;
    synonyms?: string[];
    antonyms?: string[];
  }>;
}

export const freeDictionarySource: EnrichmentSource = {
  id: 'freeDictionary',
  label: 'FreeDictionary',
  async enrich(token, ctx): Promise<SourcePartial> {
    const lang = ctx.sourceLang || 'en';
    const url = `https://api.dictionaryapi.dev/api/v2/entries/${encodeURIComponent(lang)}/${encodeURIComponent(token.trim().toLowerCase())}`;
    const data = await fetchJson<FreeDictResponse[]>(url, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
    if (!Array.isArray(data) || data.length === 0) return {};

    const partial: SourcePartial = {};
    const definitions = new Set<string>();
    const examples: Array<{ text: string }> = [];
    const synonyms = new Set<string>();
    const antonyms = new Set<string>();
    const audio: Array<{ url: string; accent?: string }> = [];
    let phonetic: string | undefined;

    for (const entry of data) {
      if (!phonetic && entry.phonetic) phonetic = entry.phonetic;
      for (const p of entry.phonetics ?? []) {
        if (p.text && !phonetic) phonetic = p.text;
        if (p.audio) {
          // Heuristic: filename suffix `-us.mp3` / `-uk.mp3` reveals accent.
          let accent: string | undefined;
          if (/-us\.mp3$/i.test(p.audio)) accent = 'US';
          else if (/-uk\.mp3$/i.test(p.audio)) accent = 'UK';
          else if (/-au\.mp3$/i.test(p.audio)) accent = 'AU';
          // Some entries carry protocol-relative URLs.
          const fixed = p.audio.startsWith('//') ? `https:${p.audio}` : p.audio;
          audio.push({ url: fixed, accent });
        }
      }
      for (const m of entry.meanings ?? []) {
        for (const s of m.synonyms ?? []) synonyms.add(s);
        for (const a of m.antonyms ?? []) antonyms.add(a);
        for (const d of m.definitions ?? []) {
          if (d.definition) definitions.add(d.definition);
          if (d.example) examples.push({ text: d.example });
          for (const s of d.synonyms ?? []) synonyms.add(s);
          for (const a of d.antonyms ?? []) antonyms.add(a);
        }
      }
    }

    if (definitions.size) partial.definitions = Array.from(definitions).slice(0, 6);
    if (examples.length) partial.examples = examples.slice(0, 5);
    if (synonyms.size) partial.synonyms = Array.from(synonyms).slice(0, 12);
    if (antonyms.size) partial.antonyms = Array.from(antonyms).slice(0, 8);
    if (audio.length) partial.audio = audio.slice(0, 4);
    if (phonetic) partial.phonetic = phonetic;
    return partial;
  },
};
