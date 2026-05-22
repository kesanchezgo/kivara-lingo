/// <reference types="chrome" />

import { onMessage } from 'webext-bridge/background';
import type {
  AiEnrichRequest,
  AiEnrichResponse,
  AnkiMapping,
  CaptureSettings,
  CreateCardRequest,
  CreateCardResponse,
  UpdateNoteFrameRequest,
  UpdateNoteFrameResponse,
  AnkiPingResponse,
  AnkiListsResponse,
  AnkiFieldsResponse,
  AudioCaptureStatus,
  AudioClipResponse,
  ResolveWordRequest,
  ResolveWordResponse,
  ResolveWordWave,
  TranscribeRequest,
  TranscribeResponse,
  TranslateRequest,
  TranslateResponse,
  TtsSpeakRequest,
  TtsResponse,
  DictionaryEntry,
} from '../shared/types';
import { ankiConnect } from './anki-connect';
import { createCardFromRequest, retryPendingNotes } from './capture-orchestrator';
import { DEFAULT_ANKI_MAPPING, DEFAULT_CAPTURE } from '../shared/store';
import {
  startAudioCapture,
  stopAudioCapture,
  extractAudioClip,
  transcribeAudioClip,
  getAudioCaptureStatus,
} from './audio-capture-manager';
import { translateText } from './translate';
import { speak } from './tts';
import { enrichWithAi, getAiSettings, getResolvedNativeLang } from './ai-enrich';
import { getVipSettings, loadTranslateTargetLang } from './vip-settings';
import { runEnrichment } from './enrichment/orchestrator';
import { getMissingPhonetic } from './phonetic-augment';
import { lookupDictionary } from '../content/nlp/dictionary';
import { lookupYomitanTerm, listYomitanPacks, deleteYomitanPack, setPackEnabled, importYomitanPackStreaming, getYomitanHeadwords } from '../content/nlp/yomitan';
import {
  BUNDLE_PACK_ID,
  MISS_PACK_ID,
  REMOTE_PACK_ID,
  recordLookupHit,
  recordMiss,
} from '../shared/telemetry';

console.log('[Kivara Lingo] service worker booting');

const STORE_KEY = 'kivara-lingo-state';
const RETRY_ALARM = 'kivara-lingo-retry-pending';
const OFFSCREEN_KEEPALIVE_ALARM = 'kivara-lingo-offscreen-keepalive';

/**
 * Chrome MV3 offscreen documents auto-close after ~30 s of inactivity.
 * While audio capture is active we ping the offscreen every 20 s to keep
 * the document alive.
 */
async function ensureOffscreenKeepalive(): Promise<void> {
  const status = getAudioCaptureStatus();
  if (status.active) {
    await chrome.alarms.create(OFFSCREEN_KEEPALIVE_ALARM, { periodInMinutes: 0.33 }); // ~20s
  } else {
    await chrome.alarms.clear(OFFSCREEN_KEEPALIVE_ALARM);
  }
}

/**
 * AnkiConnect's default `webCorsOriginList` is `["http://localhost"]`.
 * MV3 service-worker fetches send `Origin: chrome-extension://<id>` which
 * AnkiConnect rejects — so we rewrite the header to `http://localhost`
 * for every request to the AnkiConnect endpoint. This is the same trick
 * Yomitan / Migaku Toolbar use to avoid asking the user to edit their
 * AnkiConnect config by hand.
 */
const ANKI_DNR_RULE_ID = 9981;
async function installAnkiOriginRule(): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ANKI_DNR_RULE_ID],
      addRules: [
        {
          id: ANKI_DNR_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
              {
                header: 'Origin',
                operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
                value: 'http://localhost',
              },
            ],
          },
          condition: {
            urlFilter: '|http*://127.0.0.1:8765/*',
            resourceTypes: [
              'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType,
            ],
          },
        },
        {
          id: ANKI_DNR_RULE_ID + 1,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
              {
                header: 'Origin',
                operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
                value: 'http://localhost',
              },
            ],
          },
          condition: {
            urlFilter: '|http*://localhost:8765/*',
            resourceTypes: [
              'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType,
            ],
          },
        },
      ],
    });
    console.log('[Kivara Lingo] AnkiConnect Origin rewrite rule installed');
  } catch (err) {
    console.warn('[Kivara Lingo] could not install AnkiConnect DNR rule', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void installAnkiOriginRule();
});
chrome.runtime.onStartup.addListener(() => {
  void installAnkiOriginRule();
});
// First boot of the SW after a module reload — onStartup doesn't fire on
// unpacked extensions, so install immediately too.
void installAnkiOriginRule();

async function loadMapping(): Promise<AnkiMapping> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_ANKI_MAPPING;
    const parsed = JSON.parse(value);
    const mapping = parsed?.state?.ankiMapping ?? parsed?.ankiMapping;
    if (mapping && typeof mapping === 'object') {
      return { ...DEFAULT_ANKI_MAPPING, ...mapping };
    }
  } catch (err) {
    console.warn('[Kivara Lingo] could not read mapping', err);
  }
  return DEFAULT_ANKI_MAPPING;
}

async function loadCaptureSettings(): Promise<CaptureSettings> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_CAPTURE;
    const parsed = JSON.parse(value);
    const cap = parsed?.state?.capture ?? parsed?.capture;
    if (cap && typeof cap === 'object') {
      return { ...DEFAULT_CAPTURE, ...cap };
    }
  } catch {
    // ignore
  }
  return DEFAULT_CAPTURE;
}

async function loadCaptureBufferSec(): Promise<number> {
  const cap = await loadCaptureSettings();
  return Math.max(5, cap.bufferSize ?? DEFAULT_CAPTURE.bufferSize);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJson<T>(value: T): any {
  return value as unknown as any;
}

onMessage('CREATE_CARD', async ({ data }) => {
  const request = data as unknown as CreateCardRequest;
  const [mapping, capture] = await Promise.all([loadMapping(), loadCaptureSettings()]);
  const response: CreateCardResponse = await createCardFromRequest(request, mapping, capture);
  if (response.ok) {
    console.log('[Kivara Lingo] note created:', response.noteId);
  } else {
    console.warn('[Kivara Lingo] note failed:', response.error);
  }
  return asJson(response);
});

/**
 * UPDATE_NOTE_FRAME: patches the frame field of an existing Anki note with a
 * freshly captured image. Used by the Alt+V hotkey when the auto-captured
 * frame was bad (mid-transition, fade, loading spinner).
 */
onMessage('UPDATE_NOTE_FRAME', async ({ data }) => {
  const request = data as unknown as UpdateNoteFrameRequest;
  const mapping = await loadMapping();
  let fieldName = request.fieldName ?? null;
  if (!fieldName) {
    const found = Object.entries(mapping.fieldSources ?? {}).find(
      ([, s]) => s === 'frame',
    );
    fieldName = found?.[0] ?? null;
  }
  if (!fieldName) {
    const out: UpdateNoteFrameResponse = {
      ok: false,
      error: 'No hay un campo de Anki mapeado a "frame"',
    };
    return asJson(out);
  }
  try {
    const base64 = request.frame.includes(',')
      ? request.frame.slice(request.frame.indexOf(',') + 1)
      : request.frame;
    const filename = `kivara-recapture-${Date.now()}.jpg`;
    await ankiConnect.storeMediaFile(filename, base64, mapping.ankiUrl, mapping.apiKey);
    // Anki renders pictures via `<img src="filename">` in the field HTML.
    await ankiConnect.updateNoteFields(
      request.noteId,
      { [fieldName]: `<img src="${filename}">` },
      mapping.ankiUrl,
      mapping.apiKey,
    );
    const out: UpdateNoteFrameResponse = { ok: true };
    return asJson(out);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'desconocido';
    const out: UpdateNoteFrameResponse = { ok: false, error: reason };
    return asJson(out);
  }
});

/**
 * Resolve the URL + API key for an AnkiConnect request. Callers can
 * override either by passing them explicitly in the message payload
 * (popup / CardsTab "Probar" button); when omitted we read the saved
 * mapping from chrome.storage.sync so background-triggered actions
 * (CREATE_CARD, retry alarm) honour the user's saved settings.
 */
async function resolveAnkiAuth(
  data: unknown,
): Promise<{ url?: string; apiKey?: string }> {
  const payload = (data as { url?: string; apiKey?: string } | undefined) ?? {};
  if (payload.url || payload.apiKey != null) {
    return { url: payload.url, apiKey: payload.apiKey };
  }
  const mapping = await loadMapping();
  return { url: mapping.ankiUrl, apiKey: mapping.apiKey };
}

onMessage('ANKI_PING', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  const result = await ankiConnect.ping(url, apiKey);
  const out: AnkiPingResponse = result.ok
    ? { ok: true, version: result.version }
    : { ok: false, error: result.error, code: result.code };
  return asJson(out);
});

onMessage('ANKI_DECKS', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  try {
    const [decks, models] = await Promise.all([
      ankiConnect.deckNames(url, apiKey),
      ankiConnect.modelNames(url, apiKey),
    ]);
    const out: AnkiListsResponse = { decks, models };
    return asJson(out);
  } catch (err) {
    console.warn('[Kivara Lingo] ANKI_DECKS failed', err);
    return asJson({ decks: [], models: [] } satisfies AnkiListsResponse);
  }
});

onMessage('ANKI_MODELS', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  try {
    const models = await ankiConnect.modelNames(url, apiKey);
    return asJson({ decks: [], models } satisfies AnkiListsResponse);
  } catch (err) {
    console.warn('[Kivara Lingo] ANKI_MODELS failed', err);
    return asJson({ decks: [], models: [] } satisfies AnkiListsResponse);
  }
});

onMessage('ANKI_FIELDS', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  const modelName = (data as { modelName?: string } | undefined)?.modelName;
  if (!modelName) return asJson({ fields: [] } satisfies AnkiFieldsResponse);
  try {
    const fields = await ankiConnect.modelFieldNames(modelName, url, apiKey);
    const out: AnkiFieldsResponse = { fields };
    return asJson(out);
  } catch (err) {
    console.warn('[Kivara Lingo] ANKI_FIELDS failed', err);
    return asJson({ fields: [] } satisfies AnkiFieldsResponse);
  }
});

onMessage('ANKI_CREATE_DECK', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  const deckName = (data as { deckName?: string } | undefined)?.deckName;
  if (!deckName) return asJson({ ok: false, error: 'deckName missing' });
  try {
    await ankiConnect.createDeck(deckName, url, apiKey);
    return asJson({ ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'failed';
    return asJson({ ok: false, error: reason });
  }
});

/**
 * Fetch words the user already has in their configured deck. Used by the
 * content script to mark tokens as "saved" (green highlight) from the first
 * frame, without requiring the user to hover each word first.
 */
onMessage('ANKI_SAVED_WORDS', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  const deckName = (data as { deckName?: string } | undefined)?.deckName;
  const fieldName = (data as { fieldName?: string } | undefined)?.fieldName || 'Front';
  if (!deckName) return asJson({ words: [] as string[] });
  try {
    const noteIds = await ankiConnect.findNotes(`deck:"${deckName}"`, url, apiKey);
    if (!noteIds.length) return asJson({ words: [] as string[] });
    // Limit to last 5000 notes to avoid huge IPC payloads.
    const subset = noteIds.slice(-5000);
    const infos = await ankiConnect.notesInfo(subset, url, apiKey);
    const words = infos
      .map((n) => {
        const field = n.fields[fieldName] ?? Object.values(n.fields)[0];
        return field?.value?.toLowerCase().trim() ?? '';
      })
      .filter(Boolean);
    return asJson({ words });
  } catch (err) {
    console.warn('[Kivara Lingo] ANKI_SAVED_WORDS failed', err);
    return asJson({ words: [] as string[] });
  }
});

onMessage('START_AUDIO_CAPTURE', async ({ data }) => {
  let tabId = (data as { tabId?: number } | undefined)?.tabId;
  if (tabId == null) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    } catch {
      // ignore
    }
  }
  if (tabId == null) {
    return asJson({ ok: false, error: 'No active tab' });
  }
  const bufferSec = await loadCaptureBufferSec();
  const result = await startAudioCapture(tabId, bufferSec);
  // Start the keepalive ping so Chrome doesn't close the offscreen document.
  if (result.ok) void ensureOffscreenKeepalive();
  return asJson(result);
});

onMessage('STOP_AUDIO_CAPTURE', async () => {
  await stopAudioCapture();
  // Stop the keepalive — offscreen will close on its own.
  await chrome.alarms.clear(OFFSCREEN_KEEPALIVE_ALARM);
  return asJson({ ok: true });
});

onMessage('AUDIO_CAPTURE_STATUS', async () => {
  const status: AudioCaptureStatus = getAudioCaptureStatus();
  return asJson(status);
});

onMessage('EXTRACT_AUDIO_CLIP', async ({ data }) => {
  const req = (data as { startMs: number; endMs: number; format?: 'mp3' | 'wav' | 'webm' }) ?? {};
  const { startMs, endMs } = req;
  if (typeof startMs !== 'number' || typeof endMs !== 'number') {
    return asJson({ ok: false, error: 'startMs/endMs required' } satisfies AudioClipResponse);
  }
  const capture = await loadCaptureSettings();
  const result = await extractAudioClip(startMs, endMs, {
    // Honour the caller's format preference; default to 'mp3' for Anki.
    format: req.format ?? 'mp3',
    useVad: capture.endDetect === 'vad',
    preRollMs: capture.preRoll,
    postRollMs: capture.postRoll,
  });
  return asJson(result);
});

onMessage('TRANSCRIBE_AUDIO_CLIP', async ({ data }) => {
  const req = (data as TranscribeRequest) ?? { startMs: 0, endMs: 0 };
  if (typeof req.startMs !== 'number' || typeof req.endMs !== 'number') {
    const err: TranscribeResponse = { ok: false, error: 'startMs/endMs required' };
    return asJson(err);
  }
  const capture = await loadCaptureSettings();
  const result = await transcribeAudioClip(req.startMs, req.endMs, {
    useVad: req.useVad ?? capture.endDetect === 'vad',
    preRollMs: req.preRollMs ?? capture.preRoll,
    postRollMs: req.postRollMs ?? capture.postRoll,
    language: req.language,
    whisperConfig: req.whisperConfig,
  });
  const response: TranscribeResponse = result.transcription.ok
    ? {
        ok: true,
        text: result.transcription.text,
        segments: result.transcription.segments,
        language: result.transcription.language,
        clip: result.clip,
      }
    : {
        ok: false,
        error: result.transcription.error,
        transient: result.transcription.transient,
      };
  return asJson(response);
});

onMessage('TRANSLATE', async ({ data }) => {
  const request = data as unknown as TranslateRequest;
  const response: TranslateResponse = await translateText(request);
  return asJson(response);
});

onMessage('TTS_SPEAK', async ({ data }) => {
  const { text, lang } = (data as TtsSpeakRequest) ?? { text: '', lang: 'en' };
  const response: TtsResponse = await speak(text, lang);
  return asJson(response);
});

onMessage('AI_ENRICH', async ({ data }) => {
  const request = data as unknown as AiEnrichRequest;
  const response: AiEnrichResponse = await enrichWithAi(request);
  return asJson(response);
});

/**
 * Three-wave token resolution for the popover. Performs the local dictionary
 * lookup synchronously, falls back to the remote translator when needed, and
 * (if requested) calls the AI provider. The waves are returned as an array so
 * the consumer can render them progressively without needing port-based
 * streaming — in practice the popover already has a 200 ms-ish dictionary
 * spinner so this single round-trip is acceptable.
 */
onMessage('RESOLVE_WORD', async ({ data }) => {
  const req = data as unknown as ResolveWordRequest;
  const waves: ResolveWordWave[] = [];
  const sourceLang = req.sourceLang || 'en';
  const token = (req.token ?? '').trim();
  const sentence = req.sentence ?? '';
  if (!token) {
    const empty: ResolveWordResponse = { ok: true, waves: [{ stage: 'local', entry: null }] };
    return asJson(empty);
  }

  // 1. User-installed Yomitan packs FIRST. They're higher quality than
  //    the bundled `en.json` (which has 4 151 hand-curated entries plus
  //    some imported scrap from a Wiktionary mirror) so when both have
  //    a hit we trust the Yomitan pack. The pack lookup is async (one
  //    IndexedDB hop), but cached on the same DB connection so a second
  //    hover for the same word is essentially free.
  let local: DictionaryEntry | null = null;
  let resolvedPackId: string | null = null;
  let yomitanPackTitle: string | null = null;
  try {
    const hit = await lookupYomitanTerm(token, sourceLang);
    if (hit) {
      local = hit.entry;
      yomitanPackTitle = hit.pack.title;
      resolvedPackId = hit.pack.id;
    }
  } catch (err) {
    // Pack lookup errors are non-fatal — fall through to bundled.
    console.warn('[Kivara Lingo] yomitan lookup failed', err);
  }

  // 2. Bundled dictionary (fast, sync). Only consult when the Yomitan
  //    layer didn't have a hit. The bundle is curated for high-frequency
  //    words and ships their CEFR `level` (A1, A2, B1...) which the
  //    Yomitan packs don't carry; so when the Yomitan layer hits but
  //    the bundle ALSO has the same word, we splice in the level so the
  //    popover badge keeps working.
  if (!local) {
    const bundleHit = lookupDictionary(token, sourceLang);
    if (bundleHit) {
      local = bundleHit;
      resolvedPackId = BUNDLE_PACK_ID;
    }
  } else {
    const bundleHit = lookupDictionary(token, sourceLang);
    if (bundleHit) {
      // Splice in the bundle's CEFR `level` so the popover badge keeps
      // working, and use its IPA / examples when the Yomitan hit didn't
      // ship them. Crucially we DO NOT overwrite the Yomitan
      // `translation` / `monolingual` / `bilingual` — those are higher
      // quality and the whole point of preferring the pack.
      const merged: DictionaryEntry = { ...local };
      if (!merged.level && bundleHit.level) merged.level = bundleHit.level;
      if (!merged.phonetic && bundleHit.phonetic) merged.phonetic = bundleHit.phonetic;
      if ((!merged.examples || merged.examples.length === 0) && bundleHit.examples) {
        merged.examples = bundleHit.examples;
      }
      local = merged;
    }
  }

  // Augment a missing IPA from the public Wiktionary mirror so the hover
  // popover (and any downstream save) carries pronunciation. Cached
  // aggressively — first hover for a given word may add ~200-500 ms; later
  // hovers are zero-latency. We only consult the API when the local stack
  // already resolved the word (local hit + IPA gap); a full miss falls
  // through to the remote translator chain as before.
  if (local && !local.phonetic) {
    try {
      const augmented = await getMissingPhonetic(token, sourceLang);
      if (augmented) local = { ...local, phonetic: augmented };
    } catch {
      // Best-effort — never fail RESOLVE_WORD because of the augmenter.
    }
  }
  waves.push({ stage: 'local', entry: local ?? null });
  // Emit a synthetic 'remote' wave so the popover shows "via <pack>" without
  // hitting the network when a Yomitan pack already covered the word.
  if (local && yomitanPackTitle) {
    waves.push({
      stage: 'remote',
      translation: local.translation,
      provider: `pack:${yomitanPackTitle}`,
      cached: false,
    });
  }

  let remoteServed = false;
  if (!local) {
    try {
      const remote = await translateText({ text: token, sourceLang });
      if (remote.ok && remote.translatedText) {
        remoteServed = true;
        waves.push({
          stage: 'remote',
          translation: remote.translatedText,
          provider: remote.provider ?? 'offline',
          cached: remote.cached ?? false,
        });
      } else if (!remote.ok) {
        waves.push({ stage: 'error', scope: 'remote', message: remote.error ?? 'translate failed' });
      }
    } catch (err) {
      waves.push({
        stage: 'error',
        scope: 'remote',
        message: err instanceof Error ? err.message : 'translate threw',
      });
    }
  }

  // Multi-source enrichment chain. Always runs the Standard tier
  // (Free Dictionary API + Datamuse) for audio, synonyms, antonyms,
  // collocations. When the user has flipped the VIP master switch
  // ON in settings, additionally runs every enabled scrape source
  // (Cambridge / Oxford Learner's / Longman / Collins / M-W /
  // Reverso / Linguee / WordReference / SpanishDict / Forvo /
  // Lingua Libre / Etymonline / Unsplash / Pixabay / Wikimedia /
  // DuckDuckGo / YouGlish / Google TTS fallback).
  //
  // The enrichment runs in parallel with all the other waves above
  // — we don't block the popover on it. The merged result patches
  // the local entry's missing fields and ships a `vip` block via
  // the `local` wave (already pushed earlier; we update it in
  // place by mutating the `entry` reference the wave holds).
  try {
    const vipSettings = await getVipSettings();
    const targetLang =
      (await loadTranslateTargetLang()) || sourceLang;
    const result = await runEnrichment(token, {
      sourceLang,
      targetLang,
      sentence,
      vip: vipSettings,
    });
    // Merge any fields the local layer didn't populate. We trust
    // local for `translation` / `monolingual` only when those were
    // genuinely populated by Yomitan packs (i.e. resolvedPackId is
    // not the bundled fallback or null).
    if (result.entry) {
      const merged: DictionaryEntry = {
        ...(local ?? result.entry),
        // VIP-overridable fields:
        synonyms: result.entry.synonyms ?? local?.synonyms,
        antonyms: result.entry.antonyms ?? local?.antonyms,
        collocations: result.entry.collocations ?? local?.collocations,
        audio: result.entry.audio ?? local?.audio,
        vip: result.entry.vip,
        // Phonetic: prefer the local one only when it exists; otherwise
        // adopt the Cambridge/Oxford one from the chain.
        phonetic: local?.phonetic ?? result.entry.phonetic,
        // Examples: keep the locally curated ones when present;
        // otherwise the chain's (already merged from Reverso /
        // Linguee / Cambridge / etc.).
        examples: (local?.examples?.length ?? 0) > 0 ? local!.examples : result.entry.examples,
      };
      // Replace the entry on the already-pushed `local` wave so the
      // popover gets the enriched view in a single response.
      const localWave = waves.find((w) => w.stage === 'local');
      if (localWave && localWave.stage === 'local') {
        localWave.entry = merged;
      }
      local = merged;
    }
  } catch (err) {
    console.warn('[Kivara Lingo] enrichment chain threw', err);
  }

  // Local-only telemetry — record exactly one bucket per RESOLVE_WORD so the
  // coverage widget can answer "how much was served by offline sources vs.
  // remote vs. nothing".
  void (async () => {
    if (resolvedPackId) {
      await recordLookupHit(resolvedPackId);
    } else if (remoteServed) {
      await recordLookupHit(REMOTE_PACK_ID);
    } else {
      await recordMiss(MISS_PACK_ID);
    }
  })();

  if (req.includeAi) {
    const settings = await getAiSettings();
    if (settings.provider !== 'disabled' && settings.apiKey && settings.enrichOnHover) {
      const nativeLang = await getResolvedNativeLang(settings);
      try {
        const ai = await enrichWithAi({
          token,
          sentence,
          sourceLang,
          nativeLang,
        });
        if (ai.ok) {
          waves.push({ stage: 'ai', data: ai.data });
          // Patch the local entry with AI-generated mnemonic / etymology
          // so the popover renders them inside the same VIP block as the
          // chain results, and the Anki mapper sees them when the user
          // hits save.
          if (local) {
            const newVip = { ...(local.vip ?? {}) };
            if (ai.data.mnemonic && !newVip.mnemonic) newVip.mnemonic = ai.data.mnemonic;
            if (ai.data.etymology && !newVip.etymology) newVip.etymology = ai.data.etymology;
            local.vip = newVip;
            const localWave = waves.find((w) => w.stage === 'local');
            if (localWave && localWave.stage === 'local') {
              localWave.entry = local;
            }
          }
        } else waves.push({ stage: 'error', scope: 'ai', message: ai.error });
      } catch (err) {
        waves.push({
          stage: 'error',
          scope: 'ai',
          message: err instanceof Error ? err.message : 'AI threw',
        });
      }
    }
  }

  const response: ResolveWordResponse = { ok: true, waves };
  return asJson(response);
});

async function broadcastToActive(message: { type: string; [k: string]: unknown }) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // ignore: no content script on this tab
  }
}

/**
 * Tell every tab that the set of installed Yomitan packs (or the
 * `enabled` flag of one of them) just changed, so they re-pull their
 * in-memory headword cache and the tokenizer reflects the new
 * coverage without a page reload.
 */
async function broadcastDictPacksChanged() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id == null) return;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'DICT_PACKS_CHANGED' });
        } catch {
          // No content script on this tab — fine.
        }
      }),
    );
  } catch {
    // chrome.tabs.query can throw if the SW is being torn down. Non-fatal.
  }
}

chrome.commands.onCommand.addListener(async (command: string) => {
  console.log('[Kivara Lingo] command:', command);
  await broadcastToActive({ type: 'RUN_COMMAND', command });
});

// First-run onboarding: open the onboarding page when the user first installs.
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Kivara Lingo] installed / updated', details.reason);
  if (details.reason === 'install') {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('src/onboarding/index.html'),
      });
    } catch (err) {
      console.warn('[Kivara Lingo] could not open onboarding', err);
    }
  }
  // Set up periodic retry of any queued AnkiConnect notes.
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
});

// Re-create the alarm on every SW wake-up — alarms persist across SW restarts
// but `onInstalled` only fires once.
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === OFFSCREEN_KEEPALIVE_ALARM) {
    // Ping the offscreen document to reset Chrome's 30 s inactivity timer.
    // If the document is gone (user killed it, unexpected GC), restart capture.
    try {
      const status = getAudioCaptureStatus();
      if (!status.active) {
        await chrome.alarms.clear(OFFSCREEN_KEEPALIVE_ALARM);
        return;
      }
      await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STATUS' });
    } catch {
      // If the message fails, the offscreen is gone. Clear alarm.
      await chrome.alarms.clear(OFFSCREEN_KEEPALIVE_ALARM);
    }
    return;
  }
  if (alarm.name !== RETRY_ALARM) return;
  try {
    const [mapping, capture] = await Promise.all([loadMapping(), loadCaptureSettings()]);
    const { retried, succeeded } = await retryPendingNotes(mapping, capture);
    if (retried > 0) {
      console.log('[Kivara Lingo] retry pending notes', { retried, succeeded });
    }
  } catch (err) {
    console.warn('[Kivara Lingo] retry alarm failed', err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TOGGLE_PANEL_FROM_POPUP') {
    void broadcastToActive({ type: 'TOGGLE_PANEL' });
    sendResponse({ ok: true });
    return true;
  }
  // Content script requests opening a URL in a new tab (Definir / Buscar
  // buttons). Using chrome.tabs.create ensures it opens a real new tab
  // instead of navigating within the YouTube/HBO SPA, which would kill
  // the video playback.
  if (message?.type === 'OPEN_URL' && typeof message.url === 'string') {
    void chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
    return true;
  }
  // Content script requests the list of installed dict packs. The content
  // script can't access the extension's IndexedDB directly (it sees the
  // site's DB), so we proxy through the SW which has the right origin.
  if (message?.type === 'LIST_DICT_PACKS') {
    void (async () => {
      try {
        const packs = await listYomitanPacks();
        sendResponse({ ok: true, packs });
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message, packs: [] });
      }
    })();
    return true;
  }
  if (message?.type === 'DELETE_DICT_PACK' && typeof message.id === 'string') {
    void (async () => {
      try {
        await deleteYomitanPack(message.id);
        sendResponse({ ok: true });
        void broadcastDictPacksChanged();
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
      }
    })();
    return true;
  }
  if (message?.type === 'SET_PACK_ENABLED' && typeof message.id === 'string') {
    void (async () => {
      try {
        await setPackEnabled(message.id, !!message.enabled);
        sendResponse({ ok: true });
        void broadcastDictPacksChanged();
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
      }
    })();
    return true;
  }
  // Content script asks for the full set of headwords known to the
  // user's enabled packs. Used by the tokenizer so words like `excuse`,
  // `pee`, `pants`, `seventh`, `grade` — which exist in the Wiktionary
  // packs but NOT the bundled `en.json` — get classified as `known`
  // instead of `unknown` (and therefore dressed with a real popover
  // instead of a "SIN DICC." badge).
  if (message?.type === 'GET_YOMITAN_HEADWORDS') {
    const lang = typeof message.lang === 'string' ? message.lang : 'en';
    void (async () => {
      try {
        const headwords = await getYomitanHeadwords(lang);
        sendResponse({ ok: true, headwords });
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message, headwords: [] });
      }
    })();
    return true;
  }
  // Side-panel page just imported a local file / CSV / StarDict. Fan
  // out a DICT_PACKS_CHANGED to every tab so their tokenizers re-pull.
  if (message?.type === 'DICT_PACKS_CHANGED_NOTIFY') {
    void broadcastDictPacksChanged();
    sendResponse({ ok: true });
    return true;
  }
  // UI requests downloading a dictionary pack from a URL. The SW carries the
  // extension's host_permissions so this works for hosts the content script
  // couldn't reach directly under page CORS (e.g. Cloudflare R2, GitHub
  // raw). We stream into an ArrayBuffer and reply with a number[] copy so
  // the bytes survive the structured-clone round-trip across processes.
  if (message?.type === 'FETCH_PACK_URL' && typeof message.url === 'string') {
    void (async () => {
      try {
        const url: string = message.url;
        if (!/^https?:\/\//i.test(url)) {
          sendResponse({ ok: false, error: 'URL must be http(s)://' });
          return;
        }
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) {
          sendResponse({ ok: false, error: `HTTP ${res.status} ${res.statusText}` });
          return;
        }
        const buf = await res.arrayBuffer();
        sendResponse({ ok: true, bytes: Array.from(new Uint8Array(buf)) });
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
      }
    })();
    return true;
  }
  // UI requests downloading + installing a dictionary pack end-to-end in
  // the SW. The previous flow shipped the bytes back to the side-panel
  // page, which then called `unzipSync` — that crashed the renderer for
  // packs whose decompressed size exceeded ~500 MB (the EN→EN Wiktionary
  // pack is the obvious one). Doing the download AND the streaming
  // import here keeps the heavy memory work off the renderer entirely
  // and lets us report progress back via tab broadcast.
  if (message?.type === 'INSTALL_DICT_PACK_FROM_URL' && typeof message.url === 'string') {
    void (async () => {
      const url: string = message.url;
      const tabId = _sender.tab?.id;
      const reportProgress = (info: Record<string, unknown>) => {
        const payload = {
          type: 'DICT_PACK_PROGRESS',
          url,
          ...info,
        };
        if (tabId !== undefined) {
          void chrome.tabs.sendMessage(tabId, payload).catch(() => {
            // sender tab gone — fine, the install still completes.
          });
        }
      };
      try {
        if (!/^https?:\/\//i.test(url)) {
          sendResponse({ ok: false, error: 'URL must be http(s)://' });
          return;
        }
        reportProgress({ stage: 'downloading', received: 0, total: 0 });

        // Streaming download with progress so the side-panel can render
        // a real ratio while the bytes come in.
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) {
          sendResponse({ ok: false, error: `HTTP ${res.status} ${res.statusText}` });
          return;
        }
        const totalHeader = res.headers.get('content-length');
        const total = totalHeader ? parseInt(totalHeader, 10) || 0 : 0;
        const reader = res.body?.getReader();
        if (!reader) {
          // Fallback for environments without ReadableStream — single-shot.
          const buf = await res.arrayBuffer();
          reportProgress({ stage: 'downloading', received: buf.byteLength, total: buf.byteLength });
          const result = await importYomitanPackStreaming(
            new Uint8Array(buf),
            (p) => reportProgress(p),
          );
          sendResponse(result);
          return;
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            reportProgress({ stage: 'downloading', received, total });
          }
        }
        // Concatenate the downloaded chunks into a single Uint8Array.
        // We can't avoid this allocation for fflate's Unzip — even the
        // streaming API needs the bytes — but we drop `chunks` right
        // after so the GC can reclaim the duplicated copies.
        const merged = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.length;
        }
        chunks.length = 0;
        reportProgress({
          stage: 'unzipping',
          received,
          total: total || received,
          filesDone: 0,
          filesTotal: 0,
          termsParsed: 0,
        });

        const result = await importYomitanPackStreaming(merged, (p) =>
          reportProgress(p),
        );
        if (result.ok) void broadcastDictPacksChanged();
        sendResponse(result);
      } catch (err) {
        const errorMessage = (err as Error).message ?? String(err);
        reportProgress({ stage: 'error', error: errorMessage });
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  }
  return false;
});
