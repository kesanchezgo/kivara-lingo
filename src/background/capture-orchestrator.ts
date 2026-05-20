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
import { ankiConnect, dataUrlToBase64, type AnkiMedia } from './anki-connect';
import { translateToken } from './translate';
import { extractAudioClip, getAudioCaptureStatus } from './audio-capture-manager';
import { getDB, type PendingNoteRow } from '../shared/db';
import { enrichWithAi, getAiSettings, getResolvedNativeLang } from './ai-enrich';
import { generateTtsAudio } from './tts';
import { getMissingPhonetic } from './phonetic-augment';

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

function resolveField(field: string, source: FieldSource, ctx: ResolveContext): string {
  switch (source) {
    case 'selection':
      return ctx.request.token;
    case 'cue':
      return ctx.request.sentence;
    case 'phonetic':
      return ctx.phonetic;
    case 'translation':
    case 'translate':
      // If the field name hints at "sentence translation" (not word
      // translation), prefer the full-sentence bilingual subtitle.
      // Otherwise return the word-level translation from the dictionary.
      return ctx.translation || ctx.bilingual || ctx.sentenceTranslation || '';
    case 'bilingual':
      return ctx.bilingual || ctx.translation;
    case 'monolingual':
      return ctx.monolingual;
    case 'examples':
      return ctx.examples.join('<br>');
    case 'dictionary': {
      // Legacy / deprecated catch-all kept for backward compatibility with
      // mappings persisted before phonetic/bilingual/monolingual got their
      // own explicit FieldSource. We sniff the destination field's name to
      // pick the most reasonable bucket.
      const f = field.toLowerCase();
      if (/phon|ipa|pronun/.test(f)) return ctx.phonetic;
      if (/mono|definition|definición/.test(f)) return ctx.monolingual;
      if (/example|ejemplo|sample/.test(f)) return ctx.examples.join('<br>');
      if (/bilingual|biling/.test(f)) return ctx.bilingual || ctx.translation;
      if (/translation|traduccion|traducción/.test(f)) return ctx.translation;
      return ctx.bilingual || ctx.translation;
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
    case 'tts':
    case 'word-audio':
      // The wrapper below tries to fill this field with an audio file. If
      // generation fails we leave the raw text (the word itself for word
      // audio, the sentence for the legacy `tts` source) so Anki's built-in
      // `{{tts <lang>:Field}}` template can still synthesise on review.
      return source === 'word-audio' ? ctx.request.token : ctx.request.sentence;
    case 'manual':
    case 'frame':
    case 'tabCapture':
    case 'sentence-audio':
      // Media fields — the value is appended by AnkiConnect via `picture`/`audio` arrays.
      return '';
    default:
      return '';
  }
}

async function resolveAudio(
  request: CreateCardRequest,
  capture: CaptureSettings,
): Promise<{ dataUrl: string; mime: string } | null> {
  // Prefer the explicit audio attached by the caller (e.g. content script
  // already extracted via VAD).
  if (request.audio) {
    const mime = /data:([^;]+)/.exec(request.audio)?.[1] ?? 'audio/webm';
    return { dataUrl: request.audio, mime };
  }

  // Otherwise, ask the offscreen recorder for a slice covering the cue range.
  const status = getAudioCaptureStatus();
  if (!status.active) return null;
  if (request.cueStart == null || request.cueEnd == null) return null;

  // The cue times are video-time (ms) — i.e. offsets on the media timeline.
  // The offscreen recorder tags chunks with wall-clock `Date.now()`. To slice
  // the correct window we translate video-time → wall-clock using the video's
  // currentTime captured at the moment the user hit save. The relationship is:
  //   wallClock(videoTime) = Date.now() - (videoTimeAtSave - videoTime) * 1
  // because video plays at 1× real-time (assuming no seek between cue and save).
  const now = Date.now();
  const videoNow = request.videoTimeAtSave ?? request.cueEnd ?? now;
  const preRoll = Math.max(0, capture.preRoll ?? DEFAULT_CAPTURE.preRoll);
  const postRoll = Math.max(0, capture.postRoll ?? DEFAULT_CAPTURE.postRoll);
  // How far back in wall-clock time was the cue start / end relative to "now"?
  const cueStartAgo = videoNow - request.cueStart; // ms before videoTimeAtSave
  const cueEndAgo = videoNow - request.cueEnd;     // ms before videoTimeAtSave (≥ 0)
  const start = now - cueStartAgo - preRoll;
  const end = now - cueEndAgo + postRoll;

  // VAD-on-extract trims the WebM/Opus chunk down to actual speech and
  // re-encodes as 16 kHz mono WAV — Anki plays it, file size is small and
  // the same PCM is what Whisper.cpp will consume in the ASR fallback path.
  const useVad = capture.endDetect === 'vad';
  const clip = await extractAudioClip(start, end, {
    // MP3 keeps Anki media folder small (~10× smaller than WAV PCM) and
    // syncs faster with AnkiWeb. The offscreen processor falls back to
    // WAV automatically if the MP3 encoder fails to load (e.g. CSP
    // blocking the dynamic import).
    format: 'mp3',
    useVad,
    preRollMs: preRoll,
    postRollMs: postRoll,
  });
  if (!clip.ok || !clip.dataUrl) return null;
  return { dataUrl: clip.dataUrl, mime: clip.mimeType || 'audio/mpeg' };
}

export async function createCardFromRequest(
  request: CreateCardRequest,
  mapping: AnkiMapping,
  capture: CaptureSettings = DEFAULT_CAPTURE,
): Promise<CreateCardResponse> {
  // Validate required mapping fields before attempting any work.
  if (!mapping.deckName) {
    return { ok: false, error: 'No se ha configurado un mazo de Anki (deckName vacío).' };
  }
  if (!mapping.modelName) {
    return { ok: false, error: 'No se ha configurado un modelo de nota Anki (modelName vacío).' };
  }

  const warnings: string[] = [];
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
    translation: dictionaryHit?.translation ?? '',
    bilingual: dictionaryHit?.bilingual ?? dictionaryHit?.translation ?? '',
    monolingual: dictionaryHit?.monolingual ?? '',
    phonetic: dictionaryHit?.phonetic ?? '',
    examples: dictionaryHit?.examples ?? [],
    sentenceTranslation: request.sentenceTranslation ?? '',
    ai: aiData,
  };

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

  // Frame
  const pictures: AnkiMedia[] = [];
  if (request.frame) {
    const frameField = fieldMapping.find(([, s]) => s === 'frame')?.[0];
    if (frameField) {
      const filename = safeFilename(request.token, 'jpg');
      try {
        await ankiConnect.storeMediaFile(
          filename,
          dataUrlToBase64(request.frame),
          mapping.ankiUrl,
          mapping.apiKey,
        );
        pictures.push({ filename, data: dataUrlToBase64(request.frame), fields: [frameField] });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'frame';
        warnings.push(`No se pudo guardar el frame: ${reason}`);
      }
    }
  }

  // Audio — three flavours:
  //   sentence-audio (preferred for the cue's full audio, sourced from the
  //                   live tab-capture buffer),
  //   word-audio    (TTS of the headword, generated on the fly),
  //   tabCapture/tts (legacy aliases — same behaviour, kept for backward
  //                   compatibility with saved mappings).
  // We attach sentence audio first (it's the higher-quality source) and TTS
  // as a fallback / separate field when present.
  const audios: AnkiMedia[] = [];
  const sentenceAudioField =
    fieldMapping.find(([, s]) => s === 'sentence-audio')?.[0] ??
    fieldMapping.find(([, s]) => s === 'tabCapture')?.[0];
  const wordAudioField =
    fieldMapping.find(([, s]) => s === 'word-audio')?.[0] ??
    fieldMapping.find(([, s]) => s === 'tts')?.[0];
  let sentenceAudioAttached = false;
  // 1) Sentence audio: prefer the live tab-capture slice.
  if (sentenceAudioField) {
    const resolved = await resolveAudio(request, capture);
    if (resolved) {
      const filename = safeFilename(request.token, extForMime(resolved.mime));
      try {
        await ankiConnect.storeMediaFile(
          filename,
          dataUrlToBase64(resolved.dataUrl),
          mapping.ankiUrl,
          mapping.apiKey,
        );
        audios.push({
          filename,
          data: dataUrlToBase64(resolved.dataUrl),
          fields: [sentenceAudioField],
        });
        sentenceAudioAttached = true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'audio';
        warnings.push(`No se pudo guardar el audio: ${reason}`);
      }
    } else if (getAudioCaptureStatus().active === false) {
      warnings.push('La captura de audio no está activa — no se adjuntó audio.');
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
          audios.push({ filename, data, fields: [sentenceAudioField] });
          sentenceAudioAttached = true;
        }
      } catch {
        /* swallow — TTS is best-effort */
      }
    }
  }

  // 2) Word audio: TTS the headword (not the whole sentence).
  if (wordAudioField) {
    const headword = ctx.request.token;
    try {
      const tts = await generateTtsAudio(headword, request.language ?? 'en');
      if (tts.ok) {
        const filename = safeFilename(headword, extForMime(tts.mime));
        const data = dataUrlToBase64(tts.dataUrl);
        await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
        audios.push({ filename, data, fields: [wordAudioField] });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'word-audio';
      warnings.push(`TTS palabra: ${reason}`);
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
          audios.push({ filename, data, fields: [legacyTtsField] });
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
        picture: pictures.length ? pictures : undefined,
        audio: audios.length ? audios : undefined,
        options: { allowDuplicate: false, duplicateScope: 'deck' },
      },
      mapping.ankiUrl,
      mapping.apiKey,
    );
    // Record success in dedup ledger.
    try {
      await getDB().saved_notes.put({
        token: request.token,
        language: request.language ?? 'en',
        sentence: request.sentence,
        ankiNoteId: noteId,
        createdAt: Date.now(),
      });
    } catch {
      // best-effort — ignore IndexedDB errors
    }
    return { ok: true, noteId, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'addNote failed';
    // Queue for retry by the alarm.
    try {
      await getDB().pending_notes.add({
        request,
        retries: 0,
        lastError: message,
        createdAt: Date.now(),
        nextAttemptAt: Date.now() + 60_000,
      });
    } catch {
      // ignore
    }
    return { ok: false, error: message, warnings };
  }
}

/** Drain the pending queue. Called by `chrome.alarms`. */
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
    retried += 1;
    const result = await createCardFromRequest(row.request, mapping, capture);
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
