/// <reference types="chrome" />

import type { TtsResponse, TtsSettings } from '../shared/types';
import { speakViaOffscreen } from './audio-capture-manager';
import { getAiSettings } from './ai-enrich';
import { DEFAULT_TTS, PERSIST_STORE_KEY as STORE_KEY } from '../shared/store';
import { resolveSecret } from '../shared/secret-store';

/** Read the persisted TTS settings from chrome.storage.sync. Decrypts
 *  the ElevenLabs API key transparently. */
async function getTtsSettings(): Promise<TtsSettings> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_TTS;
    const parsed = JSON.parse(value);
    const tts = parsed?.state?.tts ?? parsed?.tts;
    if (tts && typeof tts === 'object') {
      const merged: TtsSettings = { ...DEFAULT_TTS, ...tts };
      // Local slot lookup — see secret-store.ts (secrets no longer sync).
      merged.elevenLabsApiKey = await resolveSecret(
        'tts',
        'elevenLabsApiKey',
        merged.elevenLabsApiKey,
      );
      return merged;
    }
  } catch (err) {
    console.warn('[Kivara Lingo] could not read TTS settings', err);
  }
  return DEFAULT_TTS;
}

/**
 * Speak a single word.
 *
 *  - First try `chrome.tts` — it's the canonical extension API, uses
 *    system voices, works offline and doesn't require a DOM context.
 *  - If `chrome.tts` is unavailable (e.g. non-Chromium browsers via
 *    polyfill) or returns an error (e.g. no installed voice for the
 *    requested BCP-47 tag), fall back to `speechSynthesis` via the
 *    offscreen document. The Web Speech API is supported in every
 *    evergreen browser and uses whatever voices the OS ships with.
 *
 * For full-sentence audio we prefer the actor's real voice via
 * tabCapture — see `audio-capture-manager.ts`. This file only covers
 * the word-level case (vocab popover, individual saved word).
 */
export async function speak(text: string, lang: string): Promise<TtsResponse> {
  if (!text.trim()) return { ok: true };

  const chromeTtsResult = await tryChromeTts(text, lang);
  if (chromeTtsResult.ok) return chromeTtsResult;

  // chrome.tts failed → fall through to SpeechSynthesis in offscreen.
  const fallback = await speakViaOffscreen(text, lang);
  if (fallback.ok) return fallback;

  // Surface whichever error is more useful to the user.
  return {
    ok: false,
    error: fallback.error || chromeTtsResult.error || 'tts unavailable',
  };
}

/**
 * Result of generating TTS as a downloadable audio file (for attaching to an
 * Anki note). Only the OpenAI tts-1 path is wired right now — see
 * IMPLEMENTATION.md §8 for the rationale (Gemini lacks a stable public TTS,
 * Anthropic doesn't ship TTS, and `speechSynthesis` cannot be captured to a
 * blob inside an MV3 offscreen document).
 */
export type GenerateTtsResult =
  | { ok: true; dataUrl: string; mime: string }
  | { ok: false; error: string };

const OPENAI_TTS_TIMEOUT_MS = 8000;
const ELEVENLABS_TTS_TIMEOUT_MS = 12000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate a playable audio file for the given text using a remote TTS API.
 *
 * Provider preference (configurable in Settings → TTS premium):
 *   1. **ElevenLabs** — best quality, ~USD 0.18 / 1k chars on the Starter
 *      plan. Voice and model id are user-configurable; defaults to
 *      `21m00Tcm4TlvDq8ikWAM` ("Rachel") on `eleven_multilingual_v2`.
 *   2. **OpenAI tts-1** — solid quality, ~USD 0.015 / 1k chars. Reuses
 *      the existing AI-provider API key when `ai.provider === 'openai'`.
 *   3. Fallback `{ ok: false }` → orchestrator leaves the text and Anki's
 *      `{{tts <lang>:Field}}` template handles playback locally.
 *
 * `auto` (default) walks the list and picks the first provider with
 * credentials; `openai` / `elevenlabs` force a specific one; `disabled`
 * skips remote TTS entirely.
 */
export async function generateTtsAudio(text: string, lang: string): Promise<GenerateTtsResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'empty text' };

  const tts = await getTtsSettings();
  if (tts.provider === 'disabled') {
    return { ok: false, error: 'Premium TTS is disabled' };
  }

  // ElevenLabs — explicit choice or auto with credentials.
  const wantsElevenLabs =
    tts.provider === 'elevenlabs' ||
    (tts.provider === 'auto' && tts.elevenLabsApiKey);
  if (wantsElevenLabs) {
    if (!tts.elevenLabsApiKey) {
      return {
        ok: false,
        error: 'ElevenLabs requires an API key (Settings → TTS premium)',
      };
    }
    const result = await generateViaElevenLabs(trimmed, tts);
    if (result.ok) return result;
    // In auto mode, transparently fall back to OpenAI when ElevenLabs
    // misbehaves (network error, quota, etc). In explicit mode surface
    // the failure so the user knows.
    if (tts.provider !== 'auto') return result;
  }

  // OpenAI — explicit choice or auto fallthrough.
  return generateViaOpenAi(trimmed);
}

async function generateViaElevenLabs(
  text: string,
  tts: TtsSettings,
): Promise<GenerateTtsResult> {
  const voiceId = (tts.elevenLabsVoiceId || DEFAULT_TTS.elevenLabsVoiceId).trim();
  const modelId = (tts.elevenLabsModelId || DEFAULT_TTS.elevenLabsModelId).trim();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ELEVENLABS_TTS_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': tts.elevenLabsApiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        // Defaults match ElevenLabs' UI Studio — slight variance for
        // natural delivery without going off-script.
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'ElevenLabs network error',
    };
  }
  clearTimeout(timeout);
  if (!resp.ok) {
    let detail = `ElevenLabs ${resp.status}`;
    try {
      const text = await resp.text();
      if (text) detail += `: ${text.slice(0, 200)}`;
    } catch {
      /* ignore */
    }
    return { ok: false, error: detail };
  }
  try {
    const blob = await resp.blob();
    const dataUrl = await blobToDataUrl(blob);
    return { ok: true, dataUrl, mime: blob.type || 'audio/mpeg' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'ElevenLabs body read failed',
    };
  }
}

async function generateViaOpenAi(text: string): Promise<GenerateTtsResult> {
  const ai = await getAiSettings();
  if (ai.provider !== 'openai' || !ai.apiKey) {
    return {
      ok: false,
      error: 'TTS audio requires OpenAI provider + API key',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TTS_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
        response_format: 'mp3',
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenAI TTS network error',
    };
  }
  clearTimeout(timeout);
  if (!resp.ok) {
    return { ok: false, error: `OpenAI TTS ${resp.status}` };
  }
  try {
    const blob = await resp.blob();
    const dataUrl = await blobToDataUrl(blob);
    return { ok: true, dataUrl, mime: blob.type || 'audio/mpeg' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenAI TTS body read failed',
    };
  }
}

function tryChromeTts(text: string, lang: string): Promise<TtsResponse> {
  return new Promise<TtsResponse>((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tts || typeof chrome.tts.speak !== 'function') {
      resolve({ ok: false, error: 'chrome.tts unavailable' });
      return;
    }
    try {
      chrome.tts.stop();
      chrome.tts.speak(text, {
        lang,
        rate: 0.95,
        enqueue: false,
        onEvent: (event) => {
          if (event.type === 'end') resolve({ ok: true });
          if (event.type === 'error') {
            resolve({ ok: false, error: event.errorMessage ?? 'tts error' });
          }
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'tts unavailable';
      resolve({ ok: false, error: reason });
    }
  });
}
