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
  ResolveWordStreamMsg,
  ResolveWordStreamRequest,
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
import { DEFAULT_ANKI_MAPPING, DEFAULT_CAPTURE, PERSIST_STORE_KEY as STORE_KEY } from '../shared/store';
import { resolveSecret } from '../shared/secret-store';
import { escapeAnkiSearchTerm } from '../shared/anki-search';
import {
  startAudioCapture,
  stopAudioCapture,
  extractAudioClip,
  transcribeAudioClip,
  getAudioCaptureStatus,
} from './audio-capture-manager';
import { translateText } from './translate';
import { speak } from './tts';
import { enrichWithAi } from './ai-enrich';
import { resolveWordStreaming } from './resolve-word';
import { clearEnrichmentCache, clearMemEnrichmentCache } from './enrichment/orchestrator';

/** Deep-link section for OPEN_SETTINGS (see the handler below). */
const OPEN_SETTINGS_SECTION_KEY = 'kivara:open-settings-section';
import { getCacheStats, clearCaches } from './cache-admin';
import { listYomitanPacks, deleteYomitanPack, setPackEnabled, importYomitanPackStreaming, getYomitanHeadwords } from '../content/nlp/yomitan';
import { t } from '../shared/i18n';
import { fetchGuarded, validateDictPackInstallRequest } from '../shared/net-guard';

console.log('[Kivara Lingo] service worker booting');

const RETRY_ALARM = 'kivara-lingo-retry-pending';
const OFFSCREEN_KEEPALIVE_ALARM = 'kivara-lingo-offscreen-keepalive';

/**
 * Chrome MV3 offscreen documents auto-close after ~30 s of inactivity.
 * While audio capture is active we ping the offscreen every 20 s to keep
 * the document alive.
 */
async function ensureOffscreenKeepalive(): Promise<void> {
  const status = await getAudioCaptureStatus();
  if (status.active) {
    // 0.5 min. This alarm keeps the SERVICE WORKER alive during capture,
    // NOT the offscreen document: since Chrome 120 packed extensions clamp
    // any period < 0.5 min up to 30 s anyway (0.33 behaved as 0.5 in
    // production), and the offscreen doc uses USER_MEDIA + WORKERS with a
    // live stream, which is exempt from the 30 s playback-idle auto-close.
    await chrome.alarms.create(OFFSCREEN_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
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
// Hosts that need the Origin rewrite. Rebuilt by refreshAnkiOriginRules()
// whenever the user changes their Anki URL — the static manifest rule only
// covers the 8765 default, and a custom port/remote host would otherwise get
// rejected by AnkiConnect's webCorsOriginList.
let ankiDnrHosts: string[] | null = null;
async function ankiOriginRules(hosts: string[]): Promise<chrome.declarativeNetRequest.Rule[]> {
  return hosts.slice(0, 8).map((host, i) => ({
    id: ANKI_DNR_RULE_ID + i,
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
      urlFilter: `|http*://${host}/*`,
      resourceTypes: [
        'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType,
      ],
    },
  }));
}
/** Rebuild the Origin-rewrite rules for the user's ACTUAL Anki URL
 * (custom port or remote host). Serialized through a single-flight lock so
 * concurrent callers (startup + CREATE_CARD + ANKI_PING) can't interleave
 * removeRuleIds/addRules batches and clobber each other. No-op when the
 * hosts already match. */
let dnrRefreshPromise: Promise<void> | null = null;
/** Most recent url asked for; consumed by the next queued run. */
let pendingDnrUrl: string | null = null;
export async function refreshAnkiOriginRules(ankiUrl?: string): Promise<void> {
  // Queue semantics: remember the LAST url asked for. When a run finishes,
  // if a newer url arrived while it was in flight we run once more with it
  // — otherwise the boot-time default (empty) would overwrite the custom
  // port the user configured, and the single-flight lock would swallow it.
  pendingDnrUrl = ankiUrl ?? pendingDnrUrl;
  if (dnrRefreshPromise) return dnrRefreshPromise;
  const run = async () => {
    do {
      const url = pendingDnrUrl ?? undefined;
      pendingDnrUrl = null;
      await applyDnrRules(url);
      // Release the lock HERE (same microtask as the drain check): a
      // caller arriving between the last apply and a later `finally`
      // would have been swallowed by the still-set promise.
      if (pendingDnrUrl === null) dnrRefreshPromise = null;
    } while (typeof pendingDnrUrl === 'string');
    dnrRefreshPromise = null;
  };
  dnrRefreshPromise = run();
  await dnrRefreshPromise;
}

async function applyDnrRules(ankiUrl?: string): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;
  try {
    const raw = (ankiUrl ?? '').trim() || 'http://127.0.0.1:8765';
    const withoutScheme = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const host = withoutScheme.split('/')[0] || '127.0.0.1:8765';
    const hosts = host.includes('127.0.0.1')
      ? [host, host.replace('127.0.0.1', 'localhost')]
      : host.includes('localhost')
        ? [host, host.replace('localhost', '127.0.0.1')]
        : [host];
    if (ankiDnrHosts && ankiDnrHosts.join('|') === hosts.join('|')) return;
    const rules = await ankiOriginRules(hosts);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: Array.from({ length: 10 }, (_, i) => ANKI_DNR_RULE_ID + i),
      addRules: rules,
    });
    ankiDnrHosts = hosts;
  } catch (err) {
    console.warn('[Kivara Lingo] could not refresh AnkiConnect DNR rule', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void loadMapping().then(
    (m) => refreshAnkiOriginRules(m.ankiUrl),
    () => refreshAnkiOriginRules(),
  );
});
// First boot of the SW after a module reload — onStartup doesn't fire on
// unpacked extensions, so refresh here too, plus the alarm. CRITICAL: pass
// the SAVED url; refreshing with no argument would install the 8765 default
// on every wake-up and break a configured custom port (first addNote after
// idle → CORS).
void loadMapping().then((m) => refreshAnkiOriginRules(m.ankiUrl),
  () => refreshAnkiOriginRules(),
);
void chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 }).catch(() => {});

/**
 * A grant changes what the enrichment chain can reach, so every cached answer
 * is suspect the moment it arrives — in BOTH layers. Clearing only IndexedDB
 * left the hot layer answering with the pre-grant payload for the rest of the
 * service worker's life, which is the case a user actually hits: they grant,
 * hover the SAME word again, and see the SAME "held back" strip.
 */
if (chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(() => {
    clearMemEnrichmentCache();
    void clearEnrichmentCache().catch(() => {});
  });
}

async function loadMapping(): Promise<AnkiMapping> {
  try {
    const raw = await chrome.storage.sync.get(STORE_KEY);
    const value = raw[STORE_KEY];
    if (typeof value !== 'string') return DEFAULT_ANKI_MAPPING;
    const parsed = JSON.parse(value);
    const mapping = parsed?.state?.ankiMapping ?? parsed?.ankiMapping;
    if (mapping && typeof mapping === 'object') {
      const merged: AnkiMapping = { ...DEFAULT_ANKI_MAPPING, ...mapping };
      // The apiKey lives in a local slot (see secret-store.ts); resolveSecret
      // decrypts it (with legacy blob fallback) and returns '' when
      // unreadable — never `enc:v1:` in a request to Anki.
      merged.apiKey = await resolveSecret('ankiMapping', 'apiKey', merged.apiKey);
      return merged;
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

  // Keep the Origin-rewrite rules in sync with the user's actual Anki URL
  // (custom port / remote host) so a non-default setup isn't rejected by
  // AnkiConnect's webCorsOriginList. AWAITED: the first save after the SW
  // wakes must not race the rule install — a void'd refresh meant the first
  // addNote could still hit CORS.
  await refreshAnkiOriginRules(mapping.ankiUrl);
  const response: CreateCardResponse = await createCardFromRequest(request, mapping, capture);
  if (response.ok) {
    // A new word just landed — drop the saved-words cache for this deck so
    // the green highlight picks it up without waiting for the 60 s TTL.
    invalidateSavedWordsCache(mapping.deckName);
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
      error: t('sw.noFrameField'),
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
  // Sync the rules BEFORE pinging: the ping itself is an http request that
  // needs the Origin rewrite on a custom port. Awaited for the same reason
  // as CREATE_CARD.
  if (url) await refreshAnkiOriginRules(url);
  const result = await ankiConnect.ping(url, apiKey);
  const out: AnkiPingResponse = result.ok
    ? { ok: true, version: result.version }
    : { ok: false, error: result.error, code: result.code };
  return asJson(out);
});

onMessage('ANKI_DECKS', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  if (url) await refreshAnkiOriginRules(url);
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
 *
 * Cached in the SW (module-level, keyed deck+field, 60 s TTL) because the
 * content-side useRef cache died on every SPA remount and re-pulled 5000
 * notes per navigation. Invalidated on every successful CREATE_CARD so a
 * freshly saved word lights up without waiting for the TTL.
 */
const savedWordsCache = new Map<string, { words: string[]; at: number }>();
const SAVED_WORDS_TTL_MS = 60_000;
export function invalidateSavedWordsCache(deckName?: string): void {
  if (!deckName) { savedWordsCache.clear(); return; }
  const needle = JSON.stringify(deckName);
  for (const key of Array.from(savedWordsCache.keys())) {
    // key = ["<url>","<deck>","<field>"] (JSON) — match any url/field for
    // this deck regardless of '|' or quotes inside the name.
    if (key.includes(needle)) savedWordsCache.delete(key);
  }
}
onMessage('ANKI_SAVED_WORDS', async ({ data }) => {
  const { url, apiKey } = await resolveAnkiAuth(data);
  const deckName = (data as { deckName?: string } | undefined)?.deckName;
  const fieldName = (data as { fieldName?: string } | undefined)?.fieldName || 'Front';
  if (!deckName) return asJson({ words: [] as string[] });
  // JSON key: deck names may contain "|" — prefix invalidation breaks on
  // plain concatenation. URL joins the key so two Anki profiles never
  // share a cache entry.
  const cacheKey = JSON.stringify([url ?? "", deckName, fieldName]);
  const cached = savedWordsCache.get(cacheKey) as { words: string[]; at: number } | undefined;
  if (cached && Date.now() - cached.at < SAVED_WORDS_TTL_MS) {
    return asJson({ words: cached.words });
  }
  try {
    const noteIds = await ankiConnect.findNotes(`deck:"${escapeAnkiSearchTerm(deckName)}"`, url, apiKey);
    if (!noteIds.length) return asJson({ words: [] as string[] });
    // Limit to last 5000 notes to avoid huge IPC payloads.
    const subset = noteIds.slice(-5000);
    const infos = await ankiConnect.notesInfo(subset, url, apiKey);
    const words = infos
      .map((n) => {
        const field = n.fields[fieldName] ?? Object.values(n.fields)[0];
        // Strip HTML (<img>, <b>, [sound:]) — Anki fields carry markup and
        // the overlay compares plain lowercase tokens.
        const raw = field?.value ?? '';
        const text = raw.replace(/<[^>]*>/g, ' ').replace(/\[sound:[^\]]*\]/gi, ' ');
        return text.toLowerCase().trim();
      })
      .filter(Boolean);
    savedWordsCache.set(cacheKey, { words, at: Date.now() });
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
  const status: AudioCaptureStatus = await getAudioCaptureStatus();
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
/**
 * Deep link into Settings.
 *
 * The popover's "held back" strip is the entry point when a word resolves with
 * dictionary sources held back for missing host access: nothing else on that
 * card can fix it, and a grant can only be raised from a user gesture in the
 * options page. A content script cannot open that page directly (options/ is
 * not web-accessible), so the popover asks here.
 *
 * The section lands in `chrome.storage.session` — it survives the page load and
 * disappears when the profile does, unlike `local`.
 */
onMessage(
  'OPEN_SETTINGS',
  async ({ data }) => {
    const section = String((data as { section?: string })?.section ?? '');
    if (section) {
      await chrome.storage.session.set({ [OPEN_SETTINGS_SECTION_KEY]: section }).catch(() => {});
    }
    try {
      await chrome.tabs.create({
        url: `${chrome.runtime.getURL('src/options/index.html')}${
          section ? `#${section}` : ''
        }`,
      });
    } catch (err) {
      console.warn('[Kivara Lingo] could not open settings', err);
    }
    return { ok: true };
  },
);

// Legacy one-shot path (kept for callers that don't use the streaming port).
// Reuses the SAME phased resolver as the stream so quality never diverges — it
// just collects every emit into a waves[] array and maps the stream phases back
// onto the legacy wave shape.
onMessage('RESOLVE_WORD', async ({ data }) => {
  const req = data as unknown as ResolveWordRequest;
  const waves: ResolveWordWave[] = [];
  let lastEntry: DictionaryEntry | null = null;
  await resolveWordStreaming(
    {
      token: req.token ?? '',
      sentence: req.sentence ?? '',
      sourceLang: req.sourceLang || 'en',
      includeAi: !!req.includeAi,
    },
    (msg: ResolveWordStreamMsg) => {
      switch (msg.phase) {
        case 'local':
          lastEntry = msg.entry;
          waves.push({ stage: 'local', entry: msg.entry });
          break;
        case 'translation':
          lastEntry = msg.entry ?? lastEntry;
          // Keep the local wave's entry in sync so the consumer sees the
          // merged entry on the single 'local' wave.
          {
            const lw = waves.find((w) => w.stage === 'local');
            if (lw && lw.stage === 'local') lw.entry = lastEntry;
          }
          waves.push({
            stage: 'remote',
            translation: msg.entry?.translation ?? '',
            provider: msg.provider,
            cached: msg.cached,
          });
          break;
        case 'enrichment':
          lastEntry = msg.entry ?? lastEntry;
          {
            const lw = waves.find((w) => w.stage === 'local');
            if (lw && lw.stage === 'local') lw.entry = lastEntry;
          }
          break;
        case 'ai':
          waves.push({ stage: 'ai', data: msg.data });
          break;
        case 'error':
          if (msg.scope === 'ai') {
            waves.push({ stage: 'error', scope: 'ai', message: msg.message });
          } else {
            waves.push({ stage: 'error', scope: 'remote', message: msg.message });
          }
          break;
        case 'done':
          // The phased resolver reports which sources were skipped for lack of
          // access at the end; the legacy shape carries it on the response.
          if (msg.needsAccess && msg.needsAccess.length > 0) {
            const found = response.needsAccess ?? [];
            for (const entry of msg.needsAccess) {
              if (!found.some((f) => f.source === entry.source)) found.push(entry);
            }
            response.needsAccess = found;
          }
          break;
      }
    },
  );
  const response: ResolveWordResponse = { ok: true, waves };
  return asJson(response);
});

/**
 * Streaming transport for the word popover. The content script opens a
 * Port named `kvl-resolve-word`, posts a single ResolveWordStreamRequest,
 * and receives ResolveWordStreamMsg phases as they're produced — so the
 * essential fields paint in <1 s while the slower extras stream in.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'kvl-resolve-word') return;
  let cancelled = false;
  port.onDisconnect.addListener(() => {
    cancelled = true;
  });
  port.onMessage.addListener((raw) => {
    const msg = raw as ResolveWordStreamRequest;
    if (!msg || msg.kind !== 'resolve-word') return;
    void resolveWordStreaming(
      {
        token: msg.token ?? '',
        sentence: msg.sentence ?? '',
        sourceLang: msg.sourceLang || 'en',
        includeAi: !!msg.includeAi,
        purpose: msg.purpose ?? 'popover',
      },
      (out: ResolveWordStreamMsg) => {
        if (cancelled) return;
        try {
          port.postMessage(out);
        } catch {
          // Port closed mid-stream (popover dismissed) — stop emitting.
          cancelled = true;
        }
      },
    ).catch((err) => {
      if (cancelled) return;
      try {
        port.postMessage({
          phase: 'error',
          scope: 'enrichment',
          message: err instanceof Error ? err.message : 'resolve threw',
        } satisfies ResolveWordStreamMsg);
        port.postMessage({ phase: 'done' } satisfies ResolveWordStreamMsg);
      } catch {
        /* ignore */
      }
    });
  });
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
// but `onInstalled` only fires once. Single onStartup listener (the boot
// block near the top of this file only installs DNR rules + one-shot
// refresh; the alarm lives HERE so the ordering is obvious in one place).
// NOTE: do not add a second chrome.runtime.onStartup listener elsewhere in
// this file — the DNR refresh races itself across listeners.
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  // Refresh the Origin-rewrite rules for the user's saved Anki URL at
  // every wake-up (custom port / remote host), not just on CREATE_CARD.
  try {
    const mapping = await loadMapping();
    await refreshAnkiOriginRules(mapping.ankiUrl);
  } catch {
    // ignore — CREATE_CARD refreshes again on demand
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const status = await getAudioCaptureStatus();
    if (status.active && status.tabId === tabId) {
      await stopAudioCapture();
      await chrome.alarms.clear(OFFSCREEN_KEEPALIVE_ALARM);
    }
  })();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === OFFSCREEN_KEEPALIVE_ALARM) {
    // Ping the offscreen document to reset Chrome's 30 s inactivity timer.
    // If the document is gone (user killed it, unexpected GC), restart capture.
    try {
      const status = await getAudioCaptureStatus();
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
  // Content script asks for the LIVE manifest command bindings.
  // `chrome.commands` does not exist in content-script context, so the
  // in-page shortcut guard proxies through here — otherwise it would
  // silently fall back to hardcoded defaults and double-fire a combo the
  // user remapped in chrome://extensions.
  if (message?.type === 'GET_COMMANDS') {
    try {
      const api = chrome.commands as unknown as {
        getAll?: (cb: (cmds: Array<{ name?: string; shortcut?: string }>) => void) => void;
      };
      if (typeof api.getAll !== 'function') {
        sendResponse({ ok: false, commands: [] });
        return true;
      }
      api.getAll((cmds) => {
        sendResponse({ ok: true, commands: Array.isArray(cmds) ? cmds : [] });
      });
    } catch {
      sendResponse({ ok: false, commands: [] });
    }
    return true;
  }
  // Content script requests opening a URL in a new tab (Definir / Buscar
  // buttons). Using chrome.tabs.create ensures it opens a real new tab
  // instead of navigating within the YouTube/HBO SPA, which would kill
  // the video playback. Allowlist: only http(s) — never javascript:, file:,
  // data: or chrome: URLs from a compromised/companion page message.
  if (message?.type === 'OPEN_URL' && typeof message.url === 'string') {
    if (!/^https?:\/\//i.test(message.url)) {
      sendResponse({ ok: false, error: 'URL must be http(s)://' });
      return true;
    }
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
  // Cache management — the side-panel asks for per-bucket stats and can
  // request a wipe. Proxied through the SW because the panel and content
  // script can't see the extension-origin IndexedDB directly.
  if (message?.type === 'GET_CACHE_STATS') {
    void (async () => {
      try {
        const stats = await getCacheStats();
        sendResponse({ ok: true, stats });
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
      }
    })();
    return true;
  }
  if (message?.type === 'CLEAR_CACHE') {
    void (async () => {
      try {
        const which = typeof message.which === 'string' ? message.which : 'all';
        const removed = await clearCaches(which);
        sendResponse({ ok: true, removed });
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
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
  // REMOVED: FETCH_PACK_URL (deleted 2026-10-08). It downloaded the whole
  // pack into an ArrayBuffer and replied with Array.from(Uint8Array) — a
  // 2× memory blowup that OOM-killed the renderer on the 127 MB EN→EN
  // pack — and no caller used it anymore (DictPacksSection + onboarding
  // both go through INSTALL_DICT_PACK_FROM_URL with streaming import).
  // UI requests downloading + installing a dictionary pack end-to-end in
  // the SW. The previous flow shipped the bytes back to the side-panel
  // page, which then called `unzipSync` — that crashed the renderer for
  // packs whose decompressed size exceeded ~500 MB (the EN→EN Wiktionary
  // pack is the obvious one). Doing the download AND the streaming
  // import here keeps the heavy memory work off the renderer entirely
  // and lets us report progress back via tab broadcast.
  //
  // Deliberate limits, all three:
  //  • WHO may ask — `sender.id === chrome.runtime.id` only. A web page cannot
  //    claim our id, so no site (and no content script it reached) can make
  //    the service worker download a host of its choosing.
  //  • WHERE we may go — public HTTPS only. The SW's host_permissions reach
  //    far beyond any page, so an ungated download is a port scanner pointed
  //    at the user's own machine and LAN.
  //  • HOW LONG and HOW MUCH — an overall timeout plus a byte cap, enforced
  //    against the ACTUAL stream and not just the declared length.
  // The curated catalogue is one HTTPS CDN; the "importar manualmente" box
  // accepts any public HTTPS URL that serves a Yomitan zip, self-hosted or
  // not. Local files are NOT reachable here by design.
  const DICT_PACK_TIMEOUT_MS = 120_000;
  const DICT_PACK_MAX_BYTES = 512 * 1024 * 1024;
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
        // WHO may ask and WHERE we may go — see validateDictPackInstallRequest.
        const reject = validateDictPackInstallRequest({
          senderId: _sender.id,
          runtimeId: chrome.runtime.id,
          url,
        });
        // Cancellable: the panel can abandon an install, and a pack that is
        // taking longer than the timeout still needs a deadline.
        const abort = new AbortController();
        const downloadSignal = abort.signal;
        const downloadTimer = setTimeout(() => abort.abort(), DICT_PACK_TIMEOUT_MS);
        const stopDownloadTimer = () => clearTimeout(downloadTimer);
        if (reject) {
          reportProgress({ stage: 'error', error: reject });
          sendResponse({ ok: false, error: reject });
          stopDownloadTimer();
          return;
        }
        reportProgress({ stage: 'downloading', received: 0, total: 0 });
        // Streaming download with progress so the side-panel can render
        // a real ratio while the bytes come in. Redirects are FOLLOWED (an
        // opaque 'manual' response cannot be read at all — see net-guard) and
        // the DESTINATION is validated once they have resolved, so a 302 that
        // lands on loopback/LAN is refused before any byte is read.
        //
        // `stopDownloadTimer` belongs inside `finishDownload` AND around the
        // fetch: the deadline must die the moment the last byte is in, and an
        // armed timer that fires after a finished install aborts a controller
        // nobody is listening to — and, in the reject case, arms a second
        // deadline that keeps the SW alive for a minute for nothing.
        let res: Response = new Response(null, { status: 0 });
        let downloadDone: () => void = () => {};
        try {
          const guarded = await fetchGuarded(url, {
            timeoutMs: DICT_PACK_TIMEOUT_MS,
            signal: downloadSignal,
          });
          res = guarded.response;
          downloadDone = guarded.done;
        } finally {
          // The deadline has done its job the moment the response resolves:
          // the stream itself is bounded by `downloadGuarded`'s own aborters.
          stopDownloadTimer();
        }
        const finishDownload = () => {
          stopDownloadTimer();
          try {
            downloadDone();
          } catch {
            /* already disarmed */
          }
        };
        try {
          const totalHeader = res.headers.get('content-length');
        const total = totalHeader ? parseInt(totalHeader, 10) || 0 : 0;
        if (total > DICT_PACK_MAX_BYTES) {
          sendResponse({
            ok: false,
            error: `Paquete demasiado grande (${total} bytes > ${DICT_PACK_MAX_BYTES})`,
          });
          return;
        }
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
            // Second bound: a server that omits or lies about
            // Content-Length still stops here instead of streaming until the
            // service worker is killed.
            received += value.length;
            if (received > DICT_PACK_MAX_BYTES) {
              await reader.cancel().catch(() => {});
              sendResponse({ ok: false, error: 'Paquete demasiado grande' });
              return;
            }
            chunks.push(value);
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
        } finally {
          finishDownload();
        }
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
