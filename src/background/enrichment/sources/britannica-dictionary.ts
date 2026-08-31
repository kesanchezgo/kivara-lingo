/**
 * Britannica Dictionary — Standard learner dictionary source.
 *
 * Candidate validated in docs/RAW-SOURCE-AUDIT.md and
 * docs/sources/britannica-dictionary.md. It provides simple learner
 * definitions and many natural examples. It is Standard tier because it is
 * free, no key, and complements FreeDictionary when the first Wiktionary
 * sense is too technical or the wrong POS.
 */

import { fetchHtml } from '../fetcher';
import { extractByClass, stripHtml } from '../html-utils';
import type { EnrichmentContext, EnrichmentSource, SourcePartial } from '../types';

const BASE = 'https://www.britannica.com';
const AUDIO_BASE = 'https://media.merriam-webster.com/audio/prons/en/us/mp3';
const CIRCUIT_STORAGE_KEY = 'enrichment:britannica:circuit:v1';
const CHALLENGE_COOLDOWN_MS = 10 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

interface CircuitState {
  blockedUntil: number;
  reason: 'cloudflare-challenge' | 'rate-limit';
}

async function readCircuit(): Promise<CircuitState | null> {
  try {
    const stored = await chrome.storage.local.get(CIRCUIT_STORAGE_KEY);
    const value = stored[CIRCUIT_STORAGE_KEY] as Partial<CircuitState> | undefined;
    if (!Number.isFinite(value?.blockedUntil) || value!.blockedUntil! <= Date.now()) return null;
    if (value?.reason !== 'cloudflare-challenge' && value?.reason !== 'rate-limit') return null;
    return { blockedUntil: value.blockedUntil!, reason: value.reason };
  } catch {
    return null;
  }
}

async function openCircuit(reason: CircuitState['reason'], durationMs: number): Promise<void> {
  try {
    await chrome.storage.local.set({
      [CIRCUIT_STORAGE_KEY]: { blockedUntil: Date.now() + durationMs, reason } satisfies CircuitState,
    });
  } catch {
    // Failure to persist only removes the optimisation; other sources still run.
  }
}

function norm(text?: string): string {
  return text?.replace(/\s+/g, ' ').trim() ?? '';
}

function uniquePush(arr: string[], value?: string, maxLen = 260): void {
  const text = norm(value);
  if (!text || text === '—' || text.length > maxLen) return;
  if (!arr.some((x) => x.toLowerCase() === text.toLowerCase())) arr.push(text);
}

function inferTargetPos(token: string, sentence?: string): string | undefined {
  const escaped = token.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const s = sentence?.toLowerCase() ?? '';
  if (!s) return undefined;
  if (new RegExp(`\\b(to|do|does|did|will|would|can|could|should|must|wants? to|going to)\\s+${escaped}\\b`).test(s)) return 'verb';
  if (new RegExp(`\\b(i|you|we|they|he|she|it)\\s+${escaped}\\b`).test(s)) return 'verb';
  if (new RegExp(`\\b(last|this|next|every|a|an|the)\\s+${escaped}\\b`).test(s)) return 'noun';
  return undefined;
}

function definitionScore(text: string, token: string, sentence?: string): number {
  let score = 0;
  const t = text.toLowerCase();
  const tok = token.toLowerCase();
  const pos = inferTargetPos(token, sentence);

  if (/obsolete|archaic|old-fashioned|rare/.test(t)) score += 20;
  if (/^used to|^used in|^used for|^used as/.test(t)) score += 3;

  if (tok === 'give') {
    if (/present|allow someone to have|cause or allow someone to have|provide|hand|transfer/.test(t)) score -= 12;
    if (/bend|bending|yield/.test(t)) score += 14;
    if (pos === 'verb' && /to /.test(t)) score -= 3;
  }
  if (tok === 'week') {
    if (/seven days|period of seven/.test(t)) score -= 12;
  }
  if (tok === 'know') {
    if (/aware|understand|certain|recognize|familiar/.test(t)) score -= 12;
    if (/the state of knowing/.test(t)) score += 12;
  }
  if (tok === 'run') {
    if (/move quickly|go quickly|operate|manage|be in charge/.test(t)) score -= 10;
    if (/liquid|unravel/.test(t)) score += 12;
  }
  if (tok === 'anything') {
    if (/thing of any kind|any thing|something/.test(t)) score -= 10;
    if (/degree|extent/.test(t)) score += 6;
  }
  if (tok === 'wonderful') {
    if (/extremely good|excellent|causing wonder|very good/.test(t)) score -= 10;
  }
  return score;
}

function buildAudioUrl(file: string, dir?: string): string | null {
  const clean = norm(file);
  if (!clean) return null;
  const folder = norm(dir) || clean[0]?.toLowerCase();
  if (!folder) return null;
  return `${AUDIO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(clean)}.mp3`;
}

function extractAudio(html: string): Array<{ url: string; accent?: string }> {
  const out: Array<{ url: string; accent?: string }> = [];
  const re = /<a\b[^>]*\bclass\s*=\s*("|')[^"']*\bplay_pron\b[^"']*\1[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 4) {
    const tag = m[0];
    const file = /\bdata-file\s*=\s*("|')([^"']+)\1/i.exec(tag)?.[2];
    const dir = /\bdata-dir\s*=\s*("|')([^"']+)\1/i.exec(tag)?.[2];
    const lang = /\bdata-lang\s*=\s*("|')([^"']+)\1/i.exec(tag)?.[2];
    const url = file ? buildAudioUrl(file, dir) : null;
    if (url && !out.some((a) => a.url === url)) out.push({ url, accent: /uk/i.test(lang ?? '') ? 'UK' : 'US' });
  }
  return out;
}

export const britannicaDictionarySource: EnrichmentSource = {
  id: 'britannicaDictionary',
  label: 'Britannica',
  async enrich(token, ctx: EnrichmentContext): Promise<SourcePartial> {
    const lang = (ctx.sourceLang || 'en').slice(0, 2);
    if (lang !== 'en') return {};

    const circuit = await readCircuit();
    if (circuit) {
      console.info('[kivara:enrichment:britannica] request skipped', {
        reason: circuit.reason,
        retryAfterMs: circuit.blockedUntil - Date.now(),
      });
      return {};
    }

    const query = encodeURIComponent(token.trim().toLowerCase());
    let status = 0;
    let challenged = false;
    const html = await fetchHtml(`${BASE}/dictionary/${query}`, {
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      },
      onResponse: (response) => {
        status = response.status;
        challenged = response.headers.get('cf-mitigated') === 'challenge';
      },
    });
    if (status === 429) {
      await openCircuit('rate-limit', RATE_LIMIT_COOLDOWN_MS);
      console.warn('[kivara:enrichment:britannica] HTTP 429; circuit opened', {
        cooldownMs: RATE_LIMIT_COOLDOWN_MS,
      });
    } else if (status === 403 && challenged) {
      await openCircuit('cloudflare-challenge', CHALLENGE_COOLDOWN_MS);
      console.warn('[kivara:enrichment:britannica] Cloudflare challenge; circuit opened', {
        cooldownMs: CHALLENGE_COOLDOWN_MS,
      });
    }
    if (!html) return {};

    const partial: SourcePartial = {};

    const pron = extractByClass(html, 'pron_w', 'span').map(stripHtml).find(Boolean);
    if (pron) {
      const first = /\/([^/]+)\//.exec(pron)?.[1] ?? pron.replace(/^\/+|\/+$/g, '');
      const cleaned = first.replace(/\s+/g, '').trim();
      if (cleaned) partial.phonetic = `/${cleaned}/`;
    }

    const audio = extractAudio(html);
    if (audio.length) partial.audio = audio;

    const rawDefinitions = extractByClass(html, 'def_text', 'span')
      .map(stripHtml)
      .filter((d) => d.length > 6 && d.length < 420)
      .map((text) => ({ text, score: definitionScore(text, token, ctx.sentence) }))
      .sort((a, b) => a.score - b.score);

    const definitions: string[] = [];
    for (const item of rawDefinitions) uniquePush(definitions, item.text, 420);
    if (definitions.length) partial.definitions = definitions.slice(0, 6);

    const examples: string[] = [];
    for (const ex of extractByClass(html, 'vi_content', 'div').map(stripHtml)) {
      const text = norm(ex);
      if (text.length > 8 && text.length < 240) uniquePush(examples, text, 240);
    }
    if (examples.length) partial.examples = examples.slice(0, 6).map((text) => ({ text }));

    return partial;
  },
};
