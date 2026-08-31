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
import { translateText, translateToken } from './translate';
import { extractAudioClip, getAudioCaptureStatus } from './audio-capture-manager';
import { getDB, type PendingNoteRow } from '../shared/db';
import { enrichWithAi, getAiSettings, getResolvedNativeLang } from './ai-enrich';
import { generateTtsAudio } from './tts';
import { getMissingPhonetic } from './phonetic-augment';
import { runEnrichment } from './enrichment/orchestrator';
import { getVipSettings, loadTranslateTargetLang } from './vip-settings';

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
      // The wrapper below downloads the URL and attaches it as an
      // AnkiConnect `pictures[]` entry. We leave the field text empty
      // so the binary attachment is the only content for this field.
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
): Promise<{ dataUrl: string; mime: string } | null> {
  // Prefer the explicit audio attached by the caller (e.g. content script
  // already extracted via VAD).
  if (request.audio) {
    const mime = /data:([^;]+)/.exec(request.audio)?.[1] ?? 'audio/webm';
    return { dataUrl: request.audio, mime };
  }

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

  // If the user saves while the subtitle is still being spoken, the rolling
  // recorder does not yet contain the end of the cue. Wait just long enough
  // for the cue end + post-roll to enter the buffer. If the video is paused
  // by the popover, this best-effort wait will still fall through to TTS.
  const cueEndInFuture = request.cueEnd - videoNowAtRequest;
  if (request.videoPausedAtSave && cueEndInFuture > 100) {
    // Hover/save often pauses the video before the subtitle finishes. In that
    // state the missing tail cannot enter the recorder buffer, so asking for
    // the full cue would produce silence/partial audio. Return null and let
    // the caller attach sentence TTS instead of a broken live clip.
    return null;
  }
  if (cueEndInFuture > 0) {
    await wait(Math.min(cueEndInFuture + postRoll + 150, 8_000));
  }

  // Compute the cue's wall-clock range from the relation captured at save
  // time. Use the original `requestedAt` rather than Date.now() after the
  // wait, otherwise active-cue saves drift the slice forward.
  const cueStartAgo = videoNowAtRequest - request.cueStart;
  const cueEndAgo = videoNowAtRequest - request.cueEnd;
  const start = requestedAt - cueStartAgo - preRoll;
  const end = requestedAt - cueEndAgo + postRoll;

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
        ctx.frequency = enriched.vip.frequencyEvidence
          .slice(0, 4)
          .map((evidence) => {
            const scale = evidence.scale === 'longman-spoken' ? 'Hablado' :
              evidence.scale === 'longman-written' ? 'Escrito' :
              evidence.scale === 'books-band' ? 'Libros' : evidence.scale;
            return `${scale} ${evidence.value}`;
          })
          .join(' · ');
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
  const pictures: AnkiMedia[] = [];
  const frameField = fieldMapping.find(([, s]) => s === 'frame')?.[0];
  const imageField = fieldMapping.find(([, s]) => s === 'image')?.[0];

  if (request.frame && frameField) {
    const filename = safeFilename(request.token, 'jpg');
    try {
      const data = dataUrlToBase64(request.frame);
      await ankiConnect.storeMediaFile(filename, data, mapping.ankiUrl, mapping.apiKey);
      pictures.push({ filename, data, fields: [frameField] });
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
        pictures.push({ filename, data, fields: imageTargets });
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
  // empty for these new sources.
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
        fields[sentenceAudioField] = withSound(fields[sentenceAudioField], filename);
        sentenceAudioAttached = true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'audio';
        warnings.push(`No se pudo guardar el audio: ${reason}`);
      }
    } else {
      const status = await getAudioCaptureStatus();
      if (!status.active) {
        warnings.push('La captura de audio no está activa — no se adjuntó audio.');
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
