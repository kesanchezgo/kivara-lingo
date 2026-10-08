/// <reference types="chrome" />

import type {
  AiEnrichment,
  AnkiMapping,
  CaptureSettings,
  CreateCardRequest,
  CreateCardResponse,
  FieldSource,
} from '../shared/types';
import { DEFAULT_CAPTURE } from '../shared/store';
import { ankiConnect, dataUrlToBase64, AnkiConnectError } from './anki-connect';
import { buildExactNoteQuery } from '../shared/anki-search';
import { translateText, translateToken } from './translate';
import { extractAudioClip, getAudioCaptureStatus } from './audio-capture-manager';
import { getDB, type PendingNoteRow } from '../shared/db';
import { enrichWithAi, getAiSettings, getResolvedNativeLang } from './ai-enrich';
import { generateTtsAudio } from './tts';
import { getMissingPhonetic } from './phonetic-augment';
import { runEnrichment } from './enrichment/orchestrator';
import { formatFrequencyBand, pickFrequencyWinner } from '../shared/frequency';
import { getVipSettings, loadTranslateTargetLang } from './vip-settings';
import { computeCueWindow, shouldFallbackToTts, waitForCueTailMs } from './cue-window';
import { t } from '../shared/i18n';

interface ResolveContext {
  request: CreateCardRequest;
  mapping: AnkiMapping;
  translation: string;
  bilingual: string;
  monolingual: string;
  phonetic: string;
  examples: string[];
  /** Native-language translation of the full sentence (dual subtitle). */
  sentenceTranslation: string;
  ai: AiEnrichment | null;
  /* Multi-source enrichment fields surfaced as standalone Anki sources. */
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  frequency: string;
  etymology: string;
  mnemonic: string;
  imageUrl: string;
  videoLink: string;
  /** Word-level audio URL chosen by the enrichment chain (Forvo /
   *  Cambridge / Oxford / Wikimedia / Google TTS fallback). When set,
   *  the orchestrator downloads it and attaches it to the
   *  word-audio field so Anki has a real recording to play. */
  wordAudioUrl: string;
}

function safeFilename(base: string, ext: string): string {
  const slug =
    base
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'kivara';
  return `kivara_${slug}_${Date.now()}.${ext}`;
}

function extForMime(mime: string): string {
  if (/wav|wave/.test(mime)) return 'wav';
  if (/mp3|mpeg/.test(mime)) return 'mp3';
  if (/ogg/.test(mime)) return 'ogg';
  if (/mp4|m4a|aac/.test(mime)) return 'm4a';
  return 'webm';
}

function usable(value?: string | null): string {
  const text = value?.trim() ?? '';
  if (!text || /^[-–—]+$/.test(text)) return '';
  return text;
}

function isLexicalGloss(value?: string | null): boolean {
  const text = usable(value);
  if (!text) return false;
  if (/[.!?¿¡]/.test(text)) return false;
  if (text.length > 64) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;
  // Reject translated examples or subtitle-like clauses. A bilingual gloss
  // should be a compact lexical value such as "dar", "ofrecer" or
  // "dar a". Sentences from Reverso/SpanishDict examples belong in examples,
  // never in the card's main bilingual definition.
  if (/\b(cuando|porque|aunque|mientras|entonces|taxista|casamos|regal[oó]|dije|guardara)\b/i.test(text)) {
    return false;
  }
  return true;
}

function withSound(existing: string | undefined, filename: string): string {
  const sound = `[sound:${filename}]`;
  const current = existing?.trim() ?? '';
  if (!current) return sound;
  if (current.includes(sound)) return current;
  return `${current}<br>${sound}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Encode an ArrayBuffer to base64 (no `data:` prefix). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunk the toString to avoid `RangeError: Maximum call stack size`
  // on large MP3s (~> 1 MB).
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).btoa(binary);
}

function resolveField(field: string, source: FieldSource, ctx: ResolveContext): string {
  switch (source) {
    case 'selection':
      return ctx.request.token;
    case 'cue':
      return ctx.request.sentence;
    case 'phonetic':
      return usable(ctx.phonetic);
    case 'translation':
    case 'translate':
      // In the default KivaraLingo model, `translation` is rendered below
      // the full subtitle sentence, so it must be the native-language
      // translation of that sentence. It intentionally does NOT fall back to
      // the word translation, otherwise the card shows values like
      // "cualquier cosa" under "Does anybody want anything else?".
      return usable(ctx.sentenceTranslation);
    case 'bilingual':
      // Word/phrase-level bilingual definition shown near the top of the
      // card. This falls back to the short translation only when the richer
      // bilingual bucket is absent.
      return usable(ctx.bilingual) || usable(ctx.translation);
    case 'monolingual':
      return usable(ctx.monolingual);
    case 'examples':
      return ctx.examples.join('<br>');
    case 'dictionary': {
      // Legacy / deprecated catch-all kept for backward compatibility with
      // mappings persisted before phonetic/bilingual/monolingual got their
      // own explicit FieldSource. We sniff the destination field's name to
      // pick the most reasonable bucket.
      const f = field.toLowerCase();
      if (/phon|ipa|pronun/.test(f)) return usable(ctx.phonetic);
      if (/mono|definition|definición/.test(f)) return usable(ctx.monolingual);
      if (/example|ejemplo|sample/.test(f)) return ctx.examples.join('<br>');
      if (/bilingual|biling/.test(f)) return usable(ctx.bilingual) || usable(ctx.translation);
      if (/translation|traduccion|traducción/.test(f)) return usable(ctx.sentenceTranslation);
      return usable(ctx.bilingual) || usable(ctx.translation) || usable(ctx.sentenceTranslation);
    }
    case 'ai-definition':
      return ctx.ai?.contextualDefinition ?? '';
    case 'ai-synonyms':
      return ctx.ai?.synonyms.join(', ') ?? '';
    case 'ai-collocations':
      return ctx.ai?.collocations.join(', ') ?? '';
    case 'ai-nuance':
      return ctx.ai?.nuancedTranslation ?? '';
    case 'ai-register':
      return ctx.ai?.register ?? '';
    case 'synonyms':
      return ctx.synonyms.join(', ');
    case 'antonyms':
      return ctx.antonyms.join(', ');
    case 'collocations':
      return ctx.collocations.join(', ');
    case 'frequency':
      return usable(ctx.frequency);
    case 'etymology':
      return usable(ctx.etymology);
    case 'mnemonic':
      return usable(ctx.mnemonic);
    case 'image':
      // The wrapper below downloads the URL and attaches it via
      // storeMediaFile + <img> field reference. We leave the field text
      // empty so the binary attachment is the only content for this field.
      // (When the download fails the warning surfaces and the field
      // stays empty — a legible failure mode.)
      return '';
    case 'video-link':
      return usable(ctx.videoLink) ? `<a href="${ctx.videoLink}">YouGlish</a>` : '';
    case 'word-audio':
      // Audio-only field. The card already renders the headword elsewhere;
      // returning the token here makes Anki display "know ▶" instead of just
      // the pronunciation button.
      return '';
    case 'tts':
      // Legacy text-to-speech alias keeps the old text fallback behavior for
      // mappings created before dedicated `sentence-audio` / `word-audio`.
      return ctx.request.sentence;
    case 'manual':
    case 'frame':
    case 'tabCapture':
    case 'sentence-audio':
      // Media fields start empty; the orchestrator stores media and writes
      // explicit [sound:...] markup after the field map is resolved.
      return '';
    default:
      return '';
  }
}

async function resolveAudio(
  request: CreateCardRequest,
  capture: CaptureSettings,
  /** Pre-resolved clip carried by a pending retry row — the ring buffer
   * no longer holds the cue, so reuse the first attempt's audio verbatim. */
  carriedAudio?: { dataUrl: string; mime: string } | null,
): Promise<{ dataUrl: string; mime: string } | null> {
  // Prefer the explicit audio attached by the caller (e.g. content script
  // already extracted via VAD).
  if (request.audio) {
    const mime = /data:([^;]+)/.exec(request.audio)?.[1] ?? 'audio/webm';
    return { dataUrl: request.audio, mime };
  }
  // Retry path: the pending row stored the first attempt's resolved clip.
  if (carriedAudio) return carriedAudio;

  // Otherwise, ask the offscreen recorder for a slice covering the cue range.
  const status = await getAudioCaptureStatus();
  if (!status.active) return null;
  if (request.cueStart == null || request.cueEnd == null) return null;

  // The cue times are video-time (ms) — i.e. offsets on the media timeline.
  // The offscreen recorder tags chunks with wall-clock `Date.now()`. To slice
  // the correct window we translate video-time → wall-clock using the video's
  // currentTime captured at the moment the user hit save. The relationship is:
  //   wallClock(videoTime) = Date.now() - (videoTimeAtSave - videoTime) * 1
  // because video plays at 1× real-time (assuming no seek between cue and save).
  const requestedAt = Date.now();
  const videoNowAtRequest = request.videoTimeAtSave ?? request.cueEnd;
  const preRoll = Math.max(0, capture.preRoll ?? DEFAULT_CAPTURE.preRoll);
  const postRoll = Math.max(0, capture.postRoll ?? DEFAULT_CAPTURE.postRoll);

  // Pure video-time -> wall-clock mapping (see `cue-window.ts`). Identical on
  // every platform because each adapter feeds the same three numbers.
  const { start, end, cueEndInFuture } = computeCueWindow({
    cueStart: request.cueStart,
    cueEnd: request.cueEnd,
    videoTimeAtSave: videoNowAtRequest,
    requestedAt,
    preRollMs: preRoll,
    postRollMs: postRoll,
  });

  // If the user saves while the subtitle is still being spoken, the rolling
  // recorder does not yet contain the end of the cue. Hover/save often pauses
  // the video before the subtitle finishes; in that state the missing tail
  // cannot enter the buffer, so return null and let the caller attach sentence
  // TTS instead of a broken live clip.
  if (shouldFallbackToTts(cueEndInFuture, request.videoPausedAtSave ?? false)) {
    return null;
  }
  // Otherwise wait just long enough for the cue end + post-roll to arrive.
  const waitMs = waitForCueTailMs(cueEndInFuture, postRoll);
  if (waitMs > 0) {
    await wait(waitMs);
  }

  // VAD-on-extract trims the WebM/Opus chunk down to actual speech and
  // re-encodes as 16 kHz mono WAV — Anki plays it, file size is small and
  // the same PCM is what Whisper.cpp will consume in the ASR fallback path.
  const useVad = capture.endDetect === 'vad';
  const clip = await extractAudioClip(start, end, {
    // MP3 keeps Anki media folder small (~10× smaller than WAV PCM) and
    // syncs faster with AnkiWeb. The offscreen processor falls back to
    // WAV automatically if the MP3 encoder fails to load (e.g. CSP
    // blocking the dynamic import).
    // WAV is larger but stable. The MP3 encoder currently falls back because
    // lamejs references an undefined MPEGMode in the MV3 bundle, so avoid the
    // noisy failing path until the encoder is replaced/fixed.
    format: 'wav',
    useVad,
    preRollMs: preRoll,
    postRollMs: postRoll,
  });
  if (!clip.ok || !clip.dataUrl) return null;
  return { dataUrl: clip.dataUrl, mime: clip.mimeType || 'audio/mpeg' };
}

/**
 * Retry idempotency: has this exact card already landed?
 *
 * Two checks, in order, BOTH run before any media is uploaded (a retry
 * that finds the note must not leave orphaned files in Anki):
 *  1. Local saved_notes ledger (token+language+sentence+deck) — cheap,
 *     but only records SUCCESSES, so a timeout-after-create misses it.
 *  2. Live findNotes with the shared exact query (deck + note type +
 *     quoted field:value) — catches the note the server created even
 *     though our response timed out. A ledger row is written so the
 *     next retry skips the network too.
 *
 * Returns {ok:true, noteId} when the card already exists, null when we
 * must create it. Never throws: a failed check falls through to addNote.
 */
/** Normalize a note field for identity comparison: Anki stores HTML
 * (`<b>`, `<br>`, `&nbsp;`) so a raw string compare would never match the
 * plain cue the content script sent. Strip tags/entities, collapse
 * whitespace, case-fold. */
function normalizeFieldForCompare(raw: string): string {
  return String(raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function findExistingCard(
  request: CreateCardRequest,
  mapping: AnkiMapping,
): Promise<CreateCardResponse | null> {
  try {
    const existing = await getDB().saved_notes
      .where('[token+language+sentence+deckName]')
      .equals([request.token, request.language ?? 'en', request.sentence, mapping.deckName])
      .first();
    if (existing) return { ok: true, noteId: existing.ankiNoteId, warnings: [] };
  } catch {
    // ledger unreadable — fall through to the live check
  }
  try {
    const wordField = Object.entries(mapping.fieldSources ?? {}).find(
      ([, s]) => s === 'selection',
    )?.[0] ?? 'Front';
    const query = buildExactNoteQuery({
      deckName: mapping.deckName,
      modelName: mapping.modelName,
      fieldName: wordField,
      value: request.token,
    });
    if (!query) return null;
    const found = await ankiConnect.findNotes(query, mapping.ankiUrl, mapping.apiKey);
    if (found.length === 0) return null;

    // WORD MATCH IS NOT ENOUGH: another card of the same word in a
    // different sentence must be created, not silently reported as this
    // one. Verify the cue field when the model maps one — via notesInfo,
    // because Anki search can't reliably match the sentence against HTML
    // field content (`<b>`, `&nbsp;`, `<br>`).
    const cueField = Object.entries(mapping.fieldSources ?? {}).find(
      ([, s]) => s === 'cue',
    )?.[0];
    let matchedId: number | null = null;
    if (cueField) {
      const infos = await ankiConnect.notesInfo(found.slice(0, 20), mapping.ankiUrl, mapping.apiKey);
      const want = normalizeFieldForCompare(request.sentence);
      matchedId =
        infos.find((n) => normalizeFieldForCompare(n.fields[cueField]?.value ?? '') === want)
          ?.noteId ?? null;
      // No verified match → this is a DIFFERENT card of the same word:
      // do NOT touch the ledger, fall through to addNote.
      if (matchedId === null) return null;
    } else {
      // Model maps no cue field — sentence identity can't be checked, so
      // a word match is the strongest evidence available. Documented
      // best-effort, not a silent claim.
      matchedId = found[0];
    }

    try {
      await getDB().saved_notes.put({
        token: request.token,
        language: request.language ?? 'en',
        sentence: request.sentence,
        deckName: mapping.deckName,
        ankiNoteId: matchedId,
        createdAt: Date.now(),
      });
    } catch {
      // best-effort
    }
    return { ok: true, noteId: matchedId, warnings: [] };
  } catch {
    // Anki unreachable for the check — proceed with the add
  }
  return null;
}

export async function createCardFromRequest(
  request: CreateCardRequest,
  mapping: AnkiMapping,
  capture: CaptureSettings = DEFAULT_CAPTURE,
  options: {
    fromRetry?: boolean;
    retryRowId?: number;
    /** Clip resolved on the first attempt, carried by the pending row. */
    carriedAudio?: { dataUrl: string; mime: string } | null;
  } = {},
): Promise<CreateCardResponse> {
  // Retry path skips live-audio re-extraction: resolveAudio slices the
  // CURRENT ring-buffer window, but the cue played minutes ago — re-slicing
  // now captures whatever is playing instead of the phrase. A retry reuses
  // the stored frame + request fields and only re-attempts addNote; TTS
  // fallback was already attached on the first attempt when capture was
  // impossible. (retryRowId is accepted for forward-compat logging; the
  // row update happens in retryPendingNotes.)
  void options.retryRowId;
  // Validate required mapping fields before attempting any work.
  if (!mapping.deckName) {
    return { ok: false, error: t('capture.noDeck') };
  }
  if (!mapping.modelName) {
    return { ok: false, error: t('capture.noModel') };
  }

  const warnings: string[] = [];

  // RETRY IDEMPOTENCY — first thing, before ANY work: no provider call,
  // no storeMediaFile, no frame download. A retry whose card already
  // exists (timeout-after-create) returns here, so it can't leave orphaned
  // media in Anki. First attempts skip this: the ledger can't contain the
  // card yet, and a stale row must never veto a fresh add after the user
  // deleted the note in Anki.
  if (options.fromRetry) {
    const existing = await findExistingCard(request, mapping);
    if (existing) return existing;
  }

  const dictionaryHit = await translateToken(request.token, request.language ?? 'en');

  // Optional AI enrichment — gated by the user's premium settings.
  let aiData: AiEnrichment | null = null;
  try {
    const aiSettings = await getAiSettings();
    if (aiSettings.enrichOnSave && aiSettings.provider !== 'disabled') {
      const nativeLang = await getResolvedNativeLang(aiSettings);
      const result = await enrichWithAi({
        token: request.token,
        sentence: request.sentence,
        sourceLang: request.language ?? 'en',
        nativeLang,
        platform: request.platform,
      });
      if (result.ok) aiData = result.data;
      else warnings.push(`IA no respondió: ${result.error}`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'AI failure';
    warnings.push(`IA no respondió: ${reason}`);
  }

  const ctx: ResolveContext = {
    request,
    mapping,
    translation: usable(dictionaryHit?.translation),
    // Keep bilingual as its own bucket. `resolveField('bilingual')` already
    // falls back to `translation`, so pre-filling this with the short
    // translation would block richer Reverso / WordReference / SpanishDict
    // data from replacing it below.
    bilingual: usable(dictionaryHit?.bilingual),
    monolingual: usable(dictionaryHit?.monolingual),
    phonetic: usable(dictionaryHit?.phonetic),
    examples: dictionaryHit?.examples ?? [],
    // Do not trust dual-subtitle text as the learning-card translation: it
    // often belongs to a neighbouring subtitle or is adapted/non-literal. We
    // translate the exact captured source sentence below and only use the
    // caller-provided value as a last-resort fallback if MT is unavailable.
    sentenceTranslation: '',
    ai: aiData,
    synonyms: [],
    antonyms: [],
    collocations: [],
    frequency: '',
    etymology: '',
    mnemonic: '',
    imageUrl: '',
    videoLink: '',
    wordAudioUrl: '',
  };

  let targetLang = 'es';
  try {
    targetLang = await loadTranslateTargetLang();
  } catch {
    // keep default target
  }

  if (request.sentence?.trim()) {
    try {
      const translatedSentence = await translateText({
        text: request.sentence,
        sourceLang: request.language ?? 'en',
        targetLang,
      });
      if (translatedSentence.ok && translatedSentence.translatedText) {
        ctx.sentenceTranslation = usable(translatedSentence.translatedText);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'sentence-translation';
      warnings.push(`Traducción de frase no disponible: ${reason}`);
    }
  }
  if (!ctx.sentenceTranslation) ctx.sentenceTranslation = usable(request.sentenceTranslation);

  // Multi-source enrichment chain — same one the popover uses on hover.
  // Save-time we always run it (regardless of `enrichOnSave`) because
  // the user has already committed to a card; the extra 2-3 s spent
  // hitting Forvo / Cambridge / Reverso etc. is well worth the
  // collocations / synonyms / native audio / image we get back.
  try {
    const vipSettings = await getVipSettings();
    const enriched = await runEnrichment(request.token, {
      sourceLang: request.language ?? 'en',
      targetLang,
      sentence: request.sentence,
      vip: vipSettings,
      purpose: 'card',
    });
    const e = enriched.entry;
    if (e) {
      // Patch ctx fields with the richer Standard/VIP chain. The bundled
      // dictionary paints fast but can be lexically weak, so enrichment / MT
      // candidates are allowed to replace the bundled bilingual gloss.
      if (!ctx.translation && usable(e.translation)) {
        ctx.translation = usable(e.translation);
      }
      if (!ctx.bilingual && usable(e.bilingual)) ctx.bilingual = usable(e.bilingual);
      if (!ctx.monolingual && usable(e.monolingual)) ctx.monolingual = usable(e.monolingual);
      if (!ctx.phonetic && usable(e.phonetic)) ctx.phonetic = usable(e.phonetic);
      // Examples: keep local curated examples, but append enriched examples
      // from Standard/VIP sources so the single `examples` Anki field
      // represents the same rich card the popover shows. Dedupe by text to
      // avoid saving the same sentence twice when bundled/Yomitan overlap.
      if (e.examples && e.examples.length > 0) {
        const seen = new Set<string>();
        ctx.examples = [...ctx.examples, ...e.examples]
          .filter((ex) => {
            const key = ex.trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 8);
      }
      if (e.synonyms) ctx.synonyms = e.synonyms;
      if (e.antonyms) ctx.antonyms = e.antonyms;
      if (e.collocations) ctx.collocations = e.collocations;
      // Audio: prefer human recordings (everything but Google TTS).
      if (e.audio && e.audio.length > 0) {
        const human = e.audio.find((a) => a.source !== 'googleTtsFallback');
        ctx.wordAudioUrl = (human ?? e.audio[0]).url;
      }
    }
    if (enriched.vip) {
      const sourceDefinitions = enriched.vip.definitions ?? [];
      const sourceTranslations = enriched.vip.translations ?? [];
      if (!ctx.monolingual && sourceDefinitions.length > 0) ctx.monolingual = usable(sourceDefinitions[0].text);
      const lexicalTranslations = sourceTranslations
        .map((t) => usable(t.text))
        .filter((text) => isLexicalGloss(text));
      if (!ctx.translation && lexicalTranslations.length > 0) {
        ctx.translation = lexicalTranslations[0];
      }
      if (!ctx.bilingual && lexicalTranslations.length > 0) {
        // Keep multiple clean meanings in the Anki `bilingual` field. The
        // first item is ranked for the subtitle context, but alternate
        // meanings are valuable for learners and prevent overfitting the card
        // to one sentence.
        ctx.bilingual = lexicalTranslations.slice(0, 8).join(' · ');
      }
      if (enriched.vip.frequencyEvidence?.length) {
        // One learner-facing band wins: spoken Longman > written Longman >
        // books-band. The three scales are not comparable (spoken top-1000
        // vs written top-1000 vs corpus-per-million bands), so averaging or
        // listing all three teaches nothing — a single band answers "how
        // common is this word". Verified 2026-09-09 corpus: every vip row
        // with Longman S1/W1 also carries books-band; Standard keeps
        // books-band alone and is unaffected.
        const winner = pickFrequencyWinner(enriched.vip.frequencyEvidence);
        if (winner) {
          ctx.frequency = formatFrequencyBand(winner.scale, winner.value);
        }
      }
      if (enriched.vip.etymology) ctx.etymology = enriched.vip.etymology;
      if (enriched.vip.mnemonic) ctx.mnemonic = enriched.vip.mnemonic;
      if (enriched.vip.imageUrl) ctx.imageUrl = enriched.vip.imageUrl;
      const firstVideo = enriched.vip.videoLinks?.[0];
      if (firstVideo) ctx.videoLink = firstVideo.url;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'enrichment';
    warnings.push(`Enriquecimiento parcial: ${reason}`);
  }

  // AI mnemonic / etymology overlay. The AI provider returns higher-
  // quality text when configured (proper grammar, native-language,
  // mnemonic-specific structure), so we let it fill the field when
  // the VIP scrape didn't. Whether AI also _overrides_ a Etymonline
  // hit is controlled by the user via `preferAiMnemonic` /
  // `preferAiEtymology` (default true: LLM wins for tone consistency).
  if (aiData) {
    const aiSettings = await getAiSettings();
    if (aiData.mnemonic && (!ctx.mnemonic || aiSettings.preferAiMnemonic !== false)) {
      ctx.mnemonic = aiData.mnemonic;
    }
    if (aiData.etymology && (!ctx.etymology || aiSettings.preferAiEtymology !== false)) {
      ctx.etymology = aiData.etymology;
    }
  }

  // AI image generation — DALL-E 3 only fires when:
  //   - The user has `enrichOnSave` AND `provider === 'openai'`
  //   - The user has explicitly opted into `enableDalleFallback`
  //     (paid, ~$0.04/card)
  //   - A note field is mapped to `image`
  //   - The chain didn't already provide a free image (Bing /
  //     Openverse / Pixabay / Wikimedia / DDG / Unsplash). DALL-E
  //     costs are only incurred when every free source missed.
  try {
    const imageMapped = Object.values(mapping.fieldSources ?? {}).some(
      (s) => s === 'image',
    );
    if (imageMapped && !ctx.imageUrl) {
      const aiSettings = await getAiSettings();
      if (
        aiSettings.enrichOnSave &&
        aiSettings.provider === 'openai' &&
        aiSettings.apiKey &&
        aiSettings.enableDalleFallback === true
      ) {
        const { generateAiImage } = await import('./ai-providers');
        const prompt =
          `Vocabulary mnemonic illustration for the English word "${request.token}". ` +
          `Context: ${request.sentence}. ` +
          `Style: clean, vivid, memorable, single subject, no text, no logos.`;
        const img = await generateAiImage(prompt, aiSettings);
        if (img.ok) ctx.imageUrl = img.url;
        else warnings.push(`DALL-E falló: ${img.error}`);
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'image-gen';
    warnings.push(`Imagen IA: ${reason}`);
  }

  // Fill the phonetic field on cards where the local dictionary stack
  // resolved a translation but didn't carry IPA. Best-effort, cached, and
  // never blocks the save longer than the augmenter's own timeout.
  if (!ctx.phonetic) {
    try {
      const augmented = await getMissingPhonetic(request.token, request.language ?? 'en');
      if (augmented) ctx.phonetic = augmented;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'phonetic-augment';
      warnings.push(`Fonética no disponible: ${reason}`);
    }
  }

  const fieldMapping = Object.entries(mapping.fieldSources ?? {});
  const fields: Record<string, string> = {};

  if (fieldMapping.length === 0) {
    // No explicit mapping yet → fall back to common defaults to keep the card useful.
    fields.Front = request.token;
    fields.Back = [request.sentence, ctx.translation].filter(Boolean).join('<br><br>');
  } else {
    for (const [field, source] of fieldMapping) {
      fields[field] = resolveField(field, source, ctx);
    }
  }

  // Frame + image fields. The user's note model can map any field to:
  //   - `frame` (the live video frame captured at save-time), or
  //   - `image` (a hero image fetched by the multi-source enrichment
  //              chain — Unsplash / Pixabay / Wikimedia / DDG).
  // The two paths are independent: the user can have BOTH a frame and
  // an image field on the same model. We also implement a graceful
  // fallback: when a `frame` field is mapped but the live capture
  // failed (e.g. the user saved from a screen with no `<video>`), we
  // fall back to the VIP image so the card still has a picture.
  //
  // Single-upload rule: every file goes through storeMediaFile EXACTLY
  // once and `addNote` receives only field references ([sound:] /
  // <img> tags) — the `picture[]`/`audio[]` arrays stay empty. Passing
  // both would upload the same blob twice (once via storeMediaFile, once
  // via addNote's inline media).
  const frameField = fieldMapping.find(([, s]) => s === 'frame')?.[0];
  const imageField = fieldMapping.find(([, s]) => s === 'image')?.[0];

  if (request.frame && frameField) {
    const filename = safeFilename(request.token, 'jpg');
    try {
      const data = dataUrlToBase64(request.frame);
      await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
      fields[frameField] = fields[frameField]
        ? `${fields[frameField]}<img src="${filename}">`
        : `<img src="${filename}">`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'frame';
      warnings.push(`No se pudo guardar el frame: ${reason}`);
    }
  }

  // Image field: download the URL chosen by the orchestrator and
  // attach it. Same flow handles the fallback: if `frame` was
  // mapped but no frame got captured, AND the image URL is
  // available, attach it to the frame field too.
  const imageTargets: string[] = [];
  if (imageField) imageTargets.push(imageField);
  if (frameField && !request.frame && !imageTargets.includes(frameField)) {
    imageTargets.push(frameField);
  }
  if (imageTargets.length > 0 && ctx.imageUrl) {
    try {
      const res = await fetch(ctx.imageUrl, { credentials: 'omit' });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const mime = res.headers.get('content-type') ?? 'image/jpeg';
        const ext = /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpg';
        const filename = safeFilename(`${request.token}_img`, ext);
        const data = arrayBufferToBase64(buf);
        await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
        for (const target of imageTargets) {
          fields[target] = fields[target]
            ? `${fields[target]}<img src="${filename}">`
            : `<img src="${filename}">`;
        }
      } else {
        warnings.push(`Imagen VIP no descargable: HTTP ${res.status}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'image';
      warnings.push(`Imagen VIP: ${reason}`);
    }
  }

  // Audio — three flavours:
  //   sentence-audio (preferred for the cue's full audio, sourced from the
  //                   live tab-capture buffer),
  //   word-audio    (TTS of the headword, generated on the fly),
  //   tabCapture/tts (legacy aliases — same behaviour, kept for backward
  //                   compatibility with saved mappings).
  // We attach sentence audio first (it's the higher-quality source) and TTS
  // as a fallback / separate field when present. Audio fields are written
  // explicitly as [sound:...] after storeMediaFile for maximum template
  // compatibility; the AnkiConnect `audio[]` array is intentionally left
  // empty for these new sources (single-upload rule — see frame section).
  const sentenceAudioField =
    fieldMapping.find(([, s]) => s === 'sentence-audio')?.[0] ??
    fieldMapping.find(([, s]) => s === 'tabCapture')?.[0];
  const wordAudioField =
    fieldMapping.find(([, s]) => s === 'word-audio')?.[0] ??
    fieldMapping.find(([, s]) => s === 'tts')?.[0];
  let sentenceAudioAttached = false;
  // 1) Sentence audio: prefer the live tab-capture slice — EXCEPT on retry
  // (fromRetry), where the ring buffer no longer holds the cue's audio and
  // re-slicing would capture whatever plays NOW instead of the phrase.
  // Retries reuse the clip the first attempt resolved and stored on the
  // pending row (options.carriedAudio); when the first attempt never
  // resolved one, fall through to the deterministic TTS fallback below —
  // and warn visibly so the user knows the card carries TTS, not the cue.
  // Clip the FIRST attempt resolved from the live buffer. Stashed here
  // (while the ring buffer still covers the cue) and written onto the
  // pending row if addNote fails — re-calling resolveAudio in the catch
  // would slice audio that plays MINUTES later, not the phrase.
  let firstAttemptClip: { dataUrl: string; mime: string } | null = null;
  if (sentenceAudioField && !options.fromRetry) {
    const resolved = await resolveAudio(request, capture);
    if (resolved) {
      firstAttemptClip = resolved;
      const filename = safeFilename(request.token, extForMime(resolved.mime));
      try {
        await ankiConnect.storeMediaFile(
          filename,
          dataUrlToBase64(resolved.dataUrl),
          mapping.ankiUrl,
          mapping.apiKey,
        );
        fields[sentenceAudioField] = withSound(fields[sentenceAudioField], filename);
        sentenceAudioAttached = true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'audio';
        warnings.push(`No se pudo guardar el audio: ${reason}`);
      }
    } else {
      const status = await getAudioCaptureStatus();
      if (!status.active) {
        warnings.push(t('capture.audioInactive'));
      }
    }
    // If we couldn't grab tab audio, fall through and let TTS synthesise the
    // sentence — Anki will still play it on review.
    if (!sentenceAudioAttached) {
      try {
        const tts = await generateTtsAudio(request.sentence, request.language ?? 'en');
        if (tts.ok) {
          const filename = safeFilename(`${request.token}_sentence`, extForMime(tts.mime));
          const data = dataUrlToBase64(tts.dataUrl);
          await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
          fields[sentenceAudioField] = withSound(fields[sentenceAudioField], filename);
          sentenceAudioAttached = true;
        }
      } catch {
        /* swallow — TTS is best-effort */
      }
    }
  } else if (sentenceAudioField && options.fromRetry) {
    // Three sources for the retry's clip, best first:
    //  1. carriedAudio — the first attempt resolved it from the ring buffer
    //     and stashed it on the pending row.
    //  2. request.audio — the CONTENT SCRIPT supplied the clip itself, so it
    //     rides along with the stored request. Skipping this (previous bug)
    //     dropped the human clip and fell back to TTS with a false warning.
    //  3. neither → deterministic TTS fallback, announced visibly.
    const carried =
      options.carriedAudio ??
      (request.audio
        ? {
            dataUrl: request.audio,
            mime: /data:([^;]+)/.exec(request.audio)?.[1] ?? 'audio/webm',
          }
        : null);
    if (carried) {
      try {
        const filename = safeFilename(request.token, extForMime(carried.mime));
        await ankiConnect.storeMediaFile(
          filename,
          dataUrlToBase64(carried.dataUrl),
          mapping.ankiUrl,
          mapping.apiKey,
        );
        fields[sentenceAudioField] = withSound(fields[sentenceAudioField], filename);
        sentenceAudioAttached = true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'audio';
        warnings.push(`No se pudo guardar el audio guardado: ${reason}`);
      }
    } else {
      warnings.push(t('capture.retryTts'));
      try {
        const tts = await generateTtsAudio(request.sentence, request.language ?? 'en');
        if (tts.ok) {
          const filename = safeFilename(`${request.token}_sentence`, extForMime(tts.mime));
          const data = dataUrlToBase64(tts.dataUrl);
          await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
          fields[sentenceAudioField] = withSound(fields[sentenceAudioField], filename);
          sentenceAudioAttached = true;
        }
      } catch {
        /* swallow — TTS is best-effort */
      }
    }
  }

  // 2) Word audio: prefer the multi-source enrichment URL (Forvo /
  //    Cambridge MP3 / Oxford MP3 / Wikimedia / Google TTS fallback)
  //    over the synthesised TTS path. Real human pronunciation always
  //    wins for vocabulary cards.
  if (wordAudioField) {
    const headword = ctx.request.token;
    let attached = false;
    if (ctx.wordAudioUrl) {
      try {
        const res = await fetch(ctx.wordAudioUrl, { credentials: 'omit' });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const mime = res.headers.get('content-type') ?? 'audio/mpeg';
          const data = arrayBufferToBase64(buf);
          const filename = safeFilename(headword, extForMime(mime));
          await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
          fields[wordAudioField] = withSound(fields[wordAudioField], filename);
          attached = true;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'word-audio-url';
        warnings.push(`Audio palabra (URL): ${reason}`);
      }
    }
    if (!attached) {
      // Fall back to TTS synthesis when the enrichment chain didn't
      // ship a usable URL or the download failed.
      try {
        const tts = await generateTtsAudio(headword, request.language ?? 'en');
        if (tts.ok) {
          const filename = safeFilename(headword, extForMime(tts.mime));
          const data = dataUrlToBase64(tts.dataUrl);
          await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
          fields[wordAudioField] = withSound(fields[wordAudioField], filename);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'word-audio';
        warnings.push(`TTS palabra: ${reason}`);
      }
    }
  }

  // Legacy `tts` source path: only fire when the user mapped a field to the
  // legacy alias *without* also mapping `sentence-audio`, otherwise we'd
  // double-attach audio.
  const legacyTtsField = fieldMapping.find(([, s]) => s === 'tts')?.[0];
  if (legacyTtsField && legacyTtsField !== wordAudioField && !sentenceAudioAttached) {
    const ttsText = fields[legacyTtsField] || request.sentence;
    if (ttsText) {
      try {
        const tts = await generateTtsAudio(ttsText, request.language ?? 'en');
        if (tts.ok) {
          const filename = safeFilename(request.token, extForMime(tts.mime));
          const data = dataUrlToBase64(tts.dataUrl);
          await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
          fields[legacyTtsField] = withSound(fields[legacyTtsField], filename);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'tts';
        warnings.push(`TTS no respondió: ${reason}`);
      }
    }
  }

  try {
    const noteId = await ankiConnect.addNote(
      {
        deckName: mapping.deckName,
        modelName: mapping.modelName,
        fields,
        tags: ['kivara-lingo', request.platform ?? 'web'].filter(Boolean) as string[],
        // Single-upload rule: media already lives on the Anki side via
        // storeMediaFile + [sound:]/<img> field references above. Passing
        // picture[]/audio[] here would re-upload every blob.
        options: { allowDuplicate: false, duplicateScope: 'deck' },
      },
      mapping.ankiUrl,
      mapping.apiKey,
    );
    // Record success in dedup ledger (per-deck — see pre-check above).
    try {
      await getDB().saved_notes.put({
        token: request.token,
        language: request.language ?? 'en',
        sentence: request.sentence,
        deckName: mapping.deckName,
        ankiNoteId: noteId,
        createdAt: Date.now(),
      });
    } catch {
      // best-effort — ignore IndexedDB errors
    }
    // If this success resolves a pending retry row, drop the row's stored
    // audio with it (the delete below handles the row itself).
    return { ok: true, noteId, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'addNote failed';
    // Queue for retry by the alarm — but NOT when this call already IS a
    // retry: createCardFromRequest would otherwise add a second row on
    // every failed attempt (row N fails → retry creates row N+1 → both
    // retry → exponential row growth). The retry loop updates the
    // existing row in place instead (see retryPendingNotes).
    // Permanent errors (bad API key, Anki validation, HTTP 4xx/5xx) are
    // never queued: retrying them burns the alarm budget for nothing.
    // Only transport-level failures (NETWORK / TIMEOUT — Anki closed,
    // sleeping, unreachable) earn a queue slot.
    const retryable =
      err instanceof AnkiConnectError &&
      (err.code === 'NETWORK' || err.code === 'TIMEOUT');
    if (!options.fromRetry && retryable) {
      // Stash the resolved live-audio clip on the pending row when we have
      // one: the retry runs minutes later when the ring buffer no longer
      // holds the cue. Without this the retry would either re-slice live
      // audio (wrong phrase) or fall back to TTS silently. resolveAudio was
      // already called above for the sentence-audio field — re-resolve it
      // cheaply here is wrong (buffer may have moved); instead we capture
      // the clip the FIRST attempt resolved by re-running resolveAudio
      // against the CURRENT buffer only when the failure happened at
      // addNote time (media already uploaded, buffer still warm). If that
      // fails, resolvedAudio stays null and the retry warns visibly.
      // Carry the clip the first attempt actually resolved. No re-slice:
      // resolveAudio would read the CURRENT buffer (wrong phrase by now).
      // Skip when the caller supplied the clip on the request itself —
      // request.audio already rides along, storing it twice wastes space.
      const resolvedAudio =
        !request.audio && firstAttemptClip ? firstAttemptClip : null;
      try {
        await getDB().pending_notes.add({
          request,
          retries: 0,
          lastError: message,
          createdAt: Date.now(),
          nextAttemptAt: Date.now() + 60_000,
          resolvedAudio,
        });
      } catch {
        // ignore
      }
    }
    return { ok: false, error: message, warnings };
  }
}

/** Drain the pending queue. Called by `chrome.alarms`.
 *
 * Hard cap: a row that fails MAX_RETRIES times is dropped with its last
 * error preserved in the console — otherwise a permanently-dead Anki
 * (wrong URL forever, revoked key) retries once a minute forever and the
 * queue grows without bound. Transport-only retry (the queue only ever
 * holds NETWORK/TIMEOUT rows — see createCardFromRequest).
 */
const MAX_RETRIES = 10;
export async function retryPendingNotes(
  mapping: AnkiMapping,
  capture: CaptureSettings = DEFAULT_CAPTURE,
): Promise<{ retried: number; succeeded: number }> {
  const db = getDB();
  const now = Date.now();
  let retried = 0;
  let succeeded = 0;
  let rows: PendingNoteRow[] = [];
  try {
    rows = await db.pending_notes.where('nextAttemptAt').belowOrEqual(now).toArray();
  } catch {
    return { retried: 0, succeeded: 0 };
  }
  for (const row of rows) {
    if (!row.id) continue;
    // Dead row: too many attempts. Drop it so the queue can't grow
    // forever against a permanently-dead Anki endpoint.
    if (row.retries >= MAX_RETRIES) {
      try {
        await db.pending_notes.delete(row.id);
        console.warn('[Kivara Lingo] dropping pending note after max retries', {
          token: row.request?.token,
          lastError: row.lastError,
        });
      } catch {
        // ignore
      }
      continue;
    }
    retried += 1;
    // Skip the live-audio re-extraction on retry: resolveAudio slices the
    // CURRENT ring-buffer window, but the cue's audio played minutes ago —
    // re-slicing now captures whatever is playing instead of the phrase.
    // The pending row carries the first attempt's resolved clip forward
    // (resolvedAudio); without it we fall back to deterministic TTS with
    // a visible warning (see the fromRetry branch in the audio section).
    const result = await createCardFromRequest(row.request, mapping, capture, {
      fromRetry: true,
      retryRowId: row.id,
      carriedAudio: row.resolvedAudio ?? null,
    });
    if (result.ok) {
      try {
        await db.pending_notes.delete(row.id);
        succeeded += 1;
      } catch {
        // ignore
      }
    } else {
      const nextRetries = row.retries + 1;
      const backoffMs = Math.min(60_000 * 30, 60_000 * Math.pow(2, nextRetries));
      try {
        await db.pending_notes.update(row.id, {
          retries: nextRetries,
          lastError: result.error ?? 'unknown',
          nextAttemptAt: Date.now() + backoffMs,
        });
      } catch {
        // ignore
      }
    }
  }
  return { retried, succeeded };
}
