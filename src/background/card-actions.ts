/**
 * F4 Anki actions that edit existing notes (docs/REDESIGN-V2.md §4.6).
 *
 * Thin, testable functions over `ankiConnect`; the service worker only wires
 * them to messages. Everything that touches note text is escaped here for the
 * same reason the card builder escapes it: Anki renders fields as HTML.
 */

import type {
  AnkiAddContextRequest,
  AnkiAddContextResponse,
  AnkiBrowseRequest,
  AnkiBrowseResponse,
  AnkiDeleteNoteResponse,
  AnkiWordIntervalsResponse,
  AnkiMapping,
} from '../shared/types';
import { buildExactNoteQuery, escapeAnkiSearchTerm } from '../shared/anki-search';
import { ankiConnect, AnkiConnectError, dataUrlToBase64, type AnkiCardFieldsInfo } from './anki-connect';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip Anki's HTML before comparing note text with a plain sentence. */
function plainText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\[sound:[^\]]*\]/gi, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mappedField(mapping: AnkiMapping, source: string, fallback?: string): string | undefined {
  return Object.entries(mapping.fieldSources ?? {}).find(([, s]) => s === source)?.[0] ?? fallback;
}

function withSound(existing: string | undefined, filename: string): string {
  const sound = `[sound:${filename}]`;
  const current = existing?.trim() ?? '';
  if (!current) return sound;
  if (current.includes(sound)) return current;
  return `${current}<br>${sound}`;
}

/**
 * Undo. A missing note is success: the user asked for it gone and it is.
 * Every other failure is reported so the UI can show it.
 */
export async function deleteNote(
  noteId: number,
  mapping: AnkiMapping,
): Promise<AnkiDeleteNoteResponse> {
  try {
    await ankiConnect.deleteNotes([noteId], mapping.ankiUrl, mapping.apiKey);
    return { ok: true };
  } catch (err) {
    if (err instanceof AnkiConnectError && err.code === 'ANKI' && /not found|does not exist|no such/i.test(err.message)) {
      return { ok: true, gone: true };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'deleteNotes failed' };
  }
}

/** Resolve the note a headword belongs to when the caller has no id yet. */
async function resolveNoteId(
  request: AnkiAddContextRequest,
  mapping: AnkiMapping,
): Promise<number | null> {
  if (request.noteId != null) return request.noteId;
  if (!request.token?.trim()) return null;
  const fieldName = request.fieldName ?? mappedField(mapping, 'selection', 'Front') ?? 'Front';
  const query = buildExactNoteQuery({
    deckName: request.deck?.trim() || mapping.deckName,
    modelName: mapping.modelName,
    fieldName,
    value: request.token,
  });
  if (!query) return null;
  const cards = await ankiConnect.findCards(query, mapping.ankiUrl, mapping.apiKey);
  if (cards.length === 0) return null;
  const info = await ankiConnect.cardsInfo(cards.slice(0, 1), mapping.ankiUrl, mapping.apiKey);
  return info[0]?.noteId ?? null;
}

/**
 * Add this scene: append the new sentence, frame/audio and tags to an
 * existing note instead of creating a duplicate card for the same word.
 */
export async function addContextToNote(
  request: AnkiAddContextRequest,
  mapping: AnkiMapping,
): Promise<AnkiAddContextResponse> {
  let noteId: number | null;
  try {
    noteId = await resolveNoteId(request, mapping);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'lookup failed' };
  }
  if (noteId == null) return { ok: false, error: 'note not found' };

  const tags = [...new Set((request.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  const fields: Record<string, string> = {};
  let existing: Record<string, { value: string }> = {};
  try {
    const infos = await ankiConnect.notesInfo([noteId], mapping.ankiUrl, mapping.apiKey);
    existing = infos[0]?.fields ?? {};
  } catch {
    // A failed read still lets tags and media land below.
  }

  const cueField = mappedField(mapping, 'cue');
  if (cueField && request.sentence.trim()) {
    const current = existing[cueField]?.value ?? '';
    if (!plainText(current).includes(plainText(request.sentence))) {
      const sentence = escapeHtml(request.sentence);
      fields[cueField] = current ? `${current}<br><br>${sentence}` : sentence;
    }
  }

  const frameField = mappedField(mapping, 'frame');
  if (frameField && request.frame) {
    try {
      const filename = `kivara-context-${noteId}-${Date.now()}.jpg`;
      await ankiConnect.storeMediaFile(
        filename,
        dataUrlToBase64(request.frame),
        mapping.ankiUrl,
        mapping.apiKey,
      );
      const current = existing[frameField]?.value ?? '';
      fields[frameField] = current ? `${current}<img src="${filename}">` : `<img src="${filename}">`;
    } catch {
      // best-effort: the sentence and tags still go through
    }
  }

  const audioField = mappedField(mapping, 'sentence-audio', mappedField(mapping, 'tabCapture'));
  if (audioField && request.audio) {
    try {
      const mime = /^data:([^;]+)/.exec(request.audio)?.[1] ?? 'audio/mpeg';
      const ext = /wav/.test(mime) ? 'wav' : /ogg/.test(mime) ? 'ogg' : /webm/.test(mime) ? 'webm' : 'mp3';
      const filename = `kivara-context-${noteId}-${Date.now()}.${ext}`;
      await ankiConnect.storeMediaFile(
        filename,
        dataUrlToBase64(request.audio),
        mapping.ankiUrl,
        mapping.apiKey,
      );
      fields[audioField] = withSound(existing[audioField]?.value, filename);
    } catch {
      // best-effort
    }
  }

  try {
    if (tags.length > 0) {
      await ankiConnect.addTags(tags, [noteId], mapping.ankiUrl, mapping.apiKey);
    }
    if (Object.keys(fields).length > 0) {
      await ankiConnect.updateNoteFields(noteId, fields, mapping.ankiUrl, mapping.apiKey);
    }
    return { ok: true, noteId };
  } catch (err) {
    return { ok: false, noteId, error: err instanceof Error ? err.message : 'update failed' };
  }
}

/** See in Anki: open the browser on `nid:<id>` or on the caller's query. */
export async function browseNote(
  request: AnkiBrowseRequest,
  mapping: AnkiMapping,
): Promise<AnkiBrowseResponse> {
  const query = request.noteId != null
    ? `nid:${request.noteId}`
    : (request.query ?? '').trim();
  if (!query) return { ok: false, error: 'query missing' };
  try {
    const noteIds = await ankiConnect.guiBrowse(query, mapping.ankiUrl, mapping.apiKey);
    return { ok: true, noteIds: Array.isArray(noteIds) ? noteIds : [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'guiBrowse failed' };
  }
}

/**
 * ANKI_WORD_INTERVALS: word → interval (days) SNAPSHOT for the F5 word-status
 * layer (docs/REDESIGN-V2.md §7 F5).
 *
 * Call order on AnkiConnect v6:
 *   1. `findCards('deck:"…"')` — EVERY card id of the deck, in ONE unbounded
 *      call. AnkiConnect pages matches internally server-side, so the answer
 *      covers the whole deck; nothing is cut here on purpose (the old path
 *      sliced to the last 5000 cards and silently dropped the rest).
 *   2. `getIntervals(cards)` — latest recorded interval per card, in request
 *      order. Positive values are DAYS; negative values are SECONDS (learning
 *      steps under one day) and read as 0 days.
 *   3. `cardsInfo(cards, fields: ['noteId', 'fields'])` — only the note id and
 *      the note fields are requested, so the full card record
 *      (question/answer/css/scheduling) never crosses the wire.
 *
 * Why step 3 is `cardsInfo` with an explicit field list and not `notesInfo`:
 * on AnkiConnect v6 `notesInfo(notes, query)` has NO field filter — it answers
 * with each note's full payload (tags, note type, card lists), exactly what
 * must not be pulled — and `cardsToNotes` folds cards that share a note,
 * which would break the positional card→word mapping. `cardsInfo` is the one
 * action whose `fields` parameter accepts an explicit selection.
 *
 * Steps 2 and 3 page the SAME id order in fixed batches; every batch must
 * succeed, so the answer either covers every card or fails loudly as
 * `{ ok: false, error }`. A partial map is never returned and never silently
 * truncated.
 *
 * Error contract (the caller `refreshAnkiIntervals` relies on it):
 *   `{ ok: true, words }`  — the deck was read COMPLETELY; `words` may be
 *                            empty (empty deck) and REPLACES the cached map;
 *   `{ ok: false, error }` — the query failed; the caller KEEPS its cache and
 *                            marks it stale.
 */
const INTERVALS_READ_BATCH = 1000;

/** Signed `getIntervals` value (days, or seconds when negative) → days. */
function intervalDays(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

/** The card's headword from the explicitly requested note fields. */
function headwordOf(fields: AnkiCardFieldsInfo['fields'], fieldName: string): string {
  if (!fields) return '';
  const field = fields[fieldName] ?? Object.values(fields)[0];
  return plainText(field?.value ?? '');
}

/** Step 2: latest interval (days) per card, batched over the fixed id order. */
async function readIntervals(cards: number[], mapping: AnkiMapping): Promise<number[]> {
  const out: number[] = [];
  for (let start = 0; start < cards.length; start += INTERVALS_READ_BATCH) {
    const batch = cards.slice(start, start + INTERVALS_READ_BATCH);
    const part = await ankiConnect.getIntervals(batch, mapping.ankiUrl, mapping.apiKey);
    if (!Array.isArray(part) || part.length !== batch.length) {
      throw new AnkiConnectError('getIntervals returned fewer intervals than cards.', 'ANKI');
    }
    for (const raw of part) out.push(intervalDays(raw));
  }
  return out;
}

/** Step 3: note id + note fields per card, batched over the fixed id order. */
async function readCardFields(cards: number[], mapping: AnkiMapping): Promise<AnkiCardFieldsInfo[]> {
  const out: AnkiCardFieldsInfo[] = [];
  for (let start = 0; start < cards.length; start += INTERVALS_READ_BATCH) {
    const batch = cards.slice(start, start + INTERVALS_READ_BATCH);
    const part = await ankiConnect.cardFieldsInfo(batch, ['noteId', 'fields'], mapping.ankiUrl, mapping.apiKey);
    if (!Array.isArray(part) || part.length !== batch.length) {
      throw new AnkiConnectError('cardsInfo returned fewer records than cards.', 'ANKI');
    }
    out.push(...part);
  }
  return out;
}

export async function wordIntervals(
  deck: string,
  fieldName: string,
  mapping: AnkiMapping,
): Promise<AnkiWordIntervalsResponse> {
  // No deck configured reads as an empty deck: there is nothing to query, so
  // an honest empty snapshot (the cache is replaced with {}) beats an error.
  if (!deck.trim() || !fieldName.trim()) return { ok: true, words: {} };
  try {
    const cards = await ankiConnect.findCards(
      `deck:"${escapeAnkiSearchTerm(deck)}"`,
      mapping.ankiUrl,
      mapping.apiKey,
    );
    if (!Array.isArray(cards)) {
      throw new AnkiConnectError('findCards did not return a card list.', 'ANKI');
    }
    if (cards.length === 0) return { ok: true, words: {} };

    const intervals = await readIntervals(cards, mapping);
    const infos = await readCardFields(cards, mapping);

    const words: Record<string, number> = {};
    for (let i = 0; i < cards.length; i += 1) {
      const word = headwordOf(infos[i]?.fields, fieldName);
      if (!word) continue;
      // Max: a word with several cards (duplicate notes, generated cards)
      // counts by its most advanced card.
      words[word] = Math.max(words[word] ?? 0, intervals[i]);
    }
    return { ok: true, words };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'wordIntervals failed' };
  }
}