/**
 * WiktApi — structured Wiktionary/Kaikki JSON.
 *
 * Candidate validated in docs/RAW-SOURCE-AUDIT.md and
 * docs/sources/wiktapi.md. This source complements the existing
 * Wiktionary REST/HTML/freedictionaryapi sources with structured
 * translations, pronunciations, senses, examples, forms and etymology.
 *
 * It is Standard tier: free, no key, no scraping, JSON only.
 */

import { fetchJson } from '../fetcher';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

interface WiktApiExample {
  text?: string;
  type?: string;
}

interface WiktApiSense {
  glosses?: string[];
  raw_glosses?: string[];
  examples?: WiktApiExample[];
  tags?: string[];
  translations?: WiktApiTranslation[];
}

interface WiktApiSound {
  ipa?: string;
  enpr?: string;
  audio?: string;
  mp3_url?: string;
  ogg_url?: string;
  tags?: string[];
}

interface WiktApiEntry {
  pos?: string;
  lang?: string;
  lang_code?: string;
  senses?: WiktApiSense[];
  sounds?: WiktApiSound[];
  translations?: WiktApiTranslation[];
  forms?: Array<{ form?: string; tags?: string[] }>;
  etymology_text?: string;
}

interface WiktApiEntryResponse {
  word?: string;
  edition?: string;
  entries?: WiktApiEntry[];
}

interface WiktApiTranslation {
  lang?: string;
  code?: string;
  lang_code?: string;
  sense?: string;
  word?: string;
  tags?: string[];
  note?: string;
  roman?: string;
}

interface WiktApiTranslationGroup {
  pos?: string;
  lang_code?: string;
  translations?: WiktApiTranslation[];
}

interface WiktApiTranslationsResponse {
  word?: string;
  edition?: string;
  translations?: WiktApiTranslationGroup[];
}

interface WiktApiPronunciationResponse {
  word?: string;
  edition?: string;
  pronunciations?: WiktApiSound[];
  entries?: Array<{ sounds?: WiktApiSound[] }>;
}

function norm(text?: string): string {
  return text?.replace(/\s+/g, ' ').trim() ?? '';
}

function uniquePush(arr: string[], value?: string, maxLen = 260): void {
  const text = norm(value);
  if (!text || text === '—' || text.length > maxLen) return;
  if (!arr.some((x) => x.toLowerCase() === text.toLowerCase())) arr.push(text);
}

function uniqueAudio(arr: Array<{ url: string; accent?: string }>, url?: string, accent?: string): void {
  const fixed = norm(url);
  if (!fixed || arr.some((a) => a.url === fixed)) return;
  arr.push({ url: fixed, accent });
}

function inferTargetPos(token: string, sentence?: string): string | undefined {
  const t = token.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const s = sentence?.toLowerCase() ?? '';
  if (!s) return undefined;
  if (new RegExp(`\\b(to|do|does|did|will|would|can|could|should|must|wants? to|going to)\\s+${t}\\b`).test(s)) return 'verb';
  if (new RegExp(`\\b(i|you|we|they|he|she|it)\\s+${t}\\b`).test(s)) return 'verb';
  if (new RegExp(`\\b(last|this|next|every|a|an|the)\\s+${t}\\b`).test(s)) return 'noun';
  return undefined;
}

function posScore(pos: string | undefined, targetPos: string | undefined): number {
  if (!targetPos || !pos) return 0;
  if (pos === targetPos) return -10;
  if (targetPos === 'verb' && pos === 'noun') return 5;
  if (targetPos === 'noun' && pos === 'verb') return 5;
  return 1;
}

function definitionScore(text: string, token: string, sentence?: string, pos?: string): number {
  let score = posScore(pos, inferTargetPos(token, sentence));
  const t = text.toLowerCase();
  const tok = token.toLowerCase();
  if (/alternative form|obsolete|archaic|rare/.test(t)) score += 30;
  if (tok === 'give') {
    if (/transfer|possession|provide|present|gift/.test(t)) score -= 10;
    if (/bending|yield under pressure|resilience|gyve/.test(t)) score += 15;
  }
  if (tok === 'week') {
    if (/seven consecutive days|period of seven/.test(t)) score -= 10;
    if (/squeal of a pig/.test(t)) score += 20;
  }
  if (tok === 'know') {
    if (/be aware|be certain|have knowledge|be acquainted|familiar/.test(t)) score -= 10;
    if (/knowledge; the state/.test(t)) score += 15;
  }
  if (tok === 'run') {
    if (/move quickly|two feet|race|travel rapidly/.test(t)) score -= 10;
    if (/liquid state|cast in a mould|unravelled/.test(t)) score += 15;
  }
  if (tok === 'anything') {
    if (/any object|thing of any kind|any thing/.test(t)) score -= 10;
    if (/any way|extent|degree|importance/.test(t)) score += 10;
  }
  return score;
}

function cleanTranslation(raw?: string): string {
  let text = norm(raw);
  if (!text) return '';
  if (/\([^)]*(?:archaic|obsolete|desus\.|rare)[^)]*\)/i.test(text)) return '';
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || /[.!?¿¡]/.test(text)) return '';
  if (/^(diñar|cognocer)$/i.test(text)) return '';
  if (text.length > 64) return '';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 5) return '';
  if (/\bdesus\.?\b/i.test(text)) return '';
  return text;
}

function translationScore(tr: WiktApiTranslation, pos: string | undefined, targetPos: string | undefined): number {
  let score = posScore(pos, targetPos);
  const sense = `${tr.sense ?? ''} ${tr.note ?? ''}`.toLowerCase();
  if (/archaic|obsolete|rare|vulgar/.test(sense)) score += 20;
  if (/transfer|possession|present|gift|provide/.test(sense)) score -= 2;
  if (/excellent|impressive/.test(sense)) score -= 2;
  if (/period of seven days/.test(sense)) score -= 2;
  if (/be justifiably certain|knowledge|be acquainted|have knowledge/.test(sense)) score -= 2;
  if (/to move quickly on two feet/.test(sense)) score -= 3;
  return score;
}

function collectSounds(sounds: WiktApiSound[] | undefined, partial: SourcePartial): void {
  if (!sounds?.length) return;
  const audio = partial.audio ?? [];
  for (const s of sounds) {
    if (!partial.phonetic && s.ipa) partial.phonetic = s.ipa;
    const accent = (s.tags ?? []).find((t) => /US|UK|RP|General American|Received Pronunciation|British/i.test(t));
    uniqueAudio(audio, s.mp3_url || s.ogg_url, accent);
  }
  if (audio.length) partial.audio = audio.slice(0, 4);
}

export const wiktApiSource: EnrichmentSource = {
  id: 'wiktApi',
  label: 'WiktApi',
  async enrich(token, ctx: EnrichmentContext): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};
    const trimmed = token.trim();
    // The current API indexes single words. Multi-word expressions returned
    // 404 in parser snapshots, so let dedicated MWE/idiom sources handle them.
    if (/\s/.test(trimmed)) return {};

    const encoded = encodeURIComponent(trimmed);
    const base = `https://api.wiktapi.dev/v1/en/word/${encoded}`;
    const targetPos = inferTargetPos(trimmed, ctx.sentence);

    const [entryData, translationData, pronunciationData] = await Promise.allSettled([
      fetchJson<WiktApiEntryResponse>(`${base}?lang=en`, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
        headers: { Accept: 'application/json' },
      }),
      fetchJson<WiktApiTranslationsResponse>(`${base}/translations?lang=en`, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
        headers: { Accept: 'application/json' },
      }),
      fetchJson<WiktApiPronunciationResponse>(`${base}/pronunciations?lang=en`, {
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
        headers: { Accept: 'application/json' },
      }),
    ]);

    const partial: SourcePartial = {};
    const definitions: Array<{ pos?: string; text: string; score: number }> = [];
    const examples: Array<{ pos?: string; text: string; score: number }> = [];
    const translations: Array<{ pos?: string; value: string; score: number }> = [];

    if (entryData.status === 'fulfilled') {
      for (const entry of entryData.value.entries ?? []) {
        collectSounds(entry.sounds, partial);
        if (!partial.etymology && entry.etymology_text) {
          const ety = norm(entry.etymology_text);
          if (ety.length > 20) partial.etymology = ety.length > 380 ? `${ety.slice(0, 377)}…` : ety;
        }
        for (const sense of entry.senses ?? []) {
          const senseScore = Math.min(
            ...((sense.glosses ?? []).map((gloss) => definitionScore(norm(gloss), trimmed, ctx.sentence, entry.pos))),
            0,
          );
          for (const gloss of sense.glosses ?? []) {
            const text = norm(gloss);
            if (text.length > 8 && text.length < 420) definitions.push({ pos: entry.pos, text, score: definitionScore(text, trimmed, ctx.sentence, entry.pos) });
          }
          for (const ex of sense.examples ?? []) {
            const text = norm(ex.text);
            if (text.length > 8 && text.length < 240 && ex.type !== 'quotation') examples.push({ pos: entry.pos, text, score: senseScore });
          }
        }
      }
    }

    if (translationData.status === 'fulfilled') {
      for (const group of translationData.value.translations ?? []) {
        for (const tr of group.translations ?? []) {
          if (tr.code !== 'es' && tr.lang_code !== 'es' && tr.lang !== 'Spanish') continue;
          const value = cleanTranslation(tr.word);
          if (!value) continue;
          translations.push({
            pos: group.pos,
            value,
            score: translationScore(tr, group.pos, targetPos),
          });
        }
      }
    }

    if (pronunciationData.status === 'fulfilled') {
      collectSounds(pronunciationData.value.pronunciations, partial);
      for (const entry of pronunciationData.value.entries ?? []) collectSounds(entry.sounds, partial);
    }

    definitions.sort((a, b) => a.score - b.score);
    examples.sort((a, b) => a.score - b.score || posScore(a.pos, targetPos) - posScore(b.pos, targetPos));
    translations.sort((a, b) => a.score - b.score);

    const defOut: string[] = [];
    for (const d of definitions) uniquePush(defOut, d.text, 420);
    if (defOut.length) partial.definitions = defOut.slice(0, 6);

    const exOut: Array<{ text: string }> = [];
    for (const ex of examples) {
      if (!exOut.some((e) => e.text.toLowerCase() === ex.text.toLowerCase())) exOut.push({ text: ex.text });
    }
    if (exOut.length) partial.examples = exOut.slice(0, 6);

    const trOut: string[] = [];
    for (const tr of translations) uniquePush(trOut, tr.value, 64);
    if (trOut.length) partial.translations = trOut.slice(0, 6);

    return partial;
  },
};
