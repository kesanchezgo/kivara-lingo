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
import { LEGACY_CARD_TAG } from '../shared/cards';
import { TAG_ROOT } from '../shared/study/cardTags';
import { ankiConnect, AnkiConnectError, dataUrlToBase64, type AnkiNoteInfo } from './anki-connect';
import { t } from '../shared/i18n/sw';

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

/** Result of checking whether a note was written by this extension. */
export type NoteOwnership = 'owned' | 'foreign' | 'gone' | 'unreadable';

/**
 * Ownership check for Undo (issue #39): `ANKI_DELETE_NOTE` used to delete any
 * `noteId` it was handed. A note is ours when it carries one of our tags —
 * `kivara-lingo` (the pre-registry flat tag every create has always added) or
 * any `kivara::…` hierarchical tag. The tag path is what keeps Undo working
 * for cards saved before the card registry existed.
 *
 * `gone` means Anki does not know the id: the undo goal is already met, and
 * nothing must be deleted. `unreadable` means the check itself failed (Anki
 * closed, notesInfo error) — the caller must refuse rather than assume.
 */
export async function noteOwnership(
  noteId: number,
  mapping: AnkiMapping,
): Promise<NoteOwnership> {
  let info: AnkiNoteInfo | undefined;
  try {
    const infos = await ankiConnect.notesInfo([noteId], mapping.ankiUrl, mapping.apiKey);
    info = infos[0];
  } catch {
    return 'unreadable';
  }
  if (!info || info.noteId == null) return 'gone';
  const tags = info.tags ?? [];
  return tags.some((tag) => tag === LEGACY_CARD_TAG || tag.startsWith(`${TAG_ROOT}::`))
    ? 'owned'
    : 'foreign';
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

  // Nothing new anywhere: the sentence was already on the note and neither
  // media nor tags arrived, so the caller says "already on your card" instead
  // of reporting an addition that did not happen.
  const sentenceAlreadyThere = !cueField || !request.sentence.trim()
    || plainText(existing[cueField]?.value ?? '').includes(plainText(request.sentence));
  const wroteNothing = sentenceAlreadyThere && !request.frame && !request.audio && tags.length === 0;

  // Fields FIRST, then tags: the fields carry the scene the user asked for,
  // and a tag failure must not discard them. Each write reports its own
  // failure so the caller can say honestly what landed.
  if (Object.keys(fields).length > 0) {
    try {
      await ankiConnect.updateNoteFields(noteId, fields, mapping.ankiUrl, mapping.apiKey);
    } catch (err) {
      return {
        ok: false,
        noteId,
        partial: 'fields',
        error: err instanceof Error ? err.message : 'fields update failed',
      };
    }
  }
  if (tags.length > 0) {
    try {
      await ankiConnect.addTags(tags, [noteId], mapping.ankiUrl, mapping.apiKey);
    } catch (err) {
      return {
        ok: false,
        noteId,
        partial: 'tags',
        error: err instanceof Error ? err.message : 'tags update failed',
      };
    }
  }
  return wroteNothing ? { ok: true, noteId, already: true } : { ok: true, noteId };
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
 * ANKI_WORD_INTERVALS: word → maturity/seen sentinel SNAPSHOT for the F5
 * word-status layer (docs/REDESIGN-V2.md §7 F5).
 *
 * Call order on AnkiConnect v6:
 *   1. `findNotes('deck:"..."')` — EVERY note of the deck, no truncation.
 *   2. `notesInfo(noteIds)` in fixed batches — the note `fields` (the
 *      headword) and the note's `cards` ids. `notesInfo` takes note ids only;
 *      the `render` parameter is never sent, so Anki never renders a card
 *      template to build this snapshot.
 *   3. `findCards('deck:"..." prop:ivl>=21')` — the mature card set. The card
 *      ids are joined back to notes through the `cards` array from step 2:
 *      EVERY note enters the map, answering `MATURE_DAYS` when any of its
 *      cards is mature and `SEEN_DAYS` otherwise. A note whose cards are all
 *      new still answers `SEEN_DAYS` — the word lives in the deck, which is
 *      what the dedupe and `isInAnki` ask about.
 *
 * Every read must succeed, so the answer either covers every note or fails
 * loudly as `{ ok: false, error }`. A partial map is never returned and never
 * silently truncated.
 *
 * Error contract (the caller `refreshAnkiIntervals` relies on it):
 *   `{ ok: true, words }`  — the deck was read COMPLETELY; `words` may be
 *                            empty (empty deck) and REPLACES the cached map;
 *   `{ ok: false, error }` — the query failed; the caller KEEPS its cache and
 *                            marks it stale.
 */

/**
 * Sentinel interval for a mature word. The exact interval is no longer
 * fetched: the only boundary the precedence needs is Anki's own maturity
 * threshold (`prop:ivl>=21`), so `MATURE_DAYS` values every mature word.
 */
export const MATURE_DAYS = 21;

/**
 * Sentinel interval for any word whose note has no mature card — including a
 * note created moments ago, whose cards are all new. Real intervals at this
 * stage run from 0 to 20 days; `SEEN_DAYS` is the single value the snapshot
 * reports because `>= MATURE_DAYS` is the only comparison made downstream.
 */
export const SEEN_DAYS = 0;

const NOTES_READ_BATCH = 500;

/**
 * The note's headword from its fields (`fieldName`, else the first field).
 */
function headwordOf(fields: AnkiNoteInfo['fields'] | undefined, fieldName: string): string {
  if (!fields) return '';
  const field = fields[fieldName] ?? Object.values(fields)[0];
  return plainText(field?.value ?? '');
}

/** Step 2: note fields and card ids, batched over the fixed id order. */
async function readNotes(noteIds: number[], mapping: AnkiMapping): Promise<AnkiNoteInfo[]> {
  const out: AnkiNoteInfo[] = [];
  for (let start = 0; start < noteIds.length; start += NOTES_READ_BATCH) {
    const batch = noteIds.slice(start, start + NOTES_READ_BATCH);
    const part = await ankiConnect.notesInfo(batch, mapping.ankiUrl, mapping.apiKey);
    if (!Array.isArray(part) || part.length !== batch.length) {
      throw new AnkiConnectError(
        t('anki.badRecordCount', { action: 'notesInfo' }),
        'ANKI',
      );
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
    const deckQuery = `deck:"${escapeAnkiSearchTerm(deck)}"`;
    const noteIds = await ankiConnect.findNotes(deckQuery, mapping.ankiUrl, mapping.apiKey);
    if (!Array.isArray(noteIds)) {
      throw new AnkiConnectError(t('anki.badList', { action: 'findNotes' }), 'ANKI');
    }
    if (noteIds.length === 0) return { ok: true, words: {} };

    const [notes, matureCards] = await Promise.all([
      readNotes(noteIds, mapping),
      ankiConnect.findCards(`${deckQuery} prop:ivl>=21`, mapping.ankiUrl, mapping.apiKey),
    ]);
    if (!Array.isArray(matureCards)) {
      throw new AnkiConnectError(t('anki.badList', { action: 'findCards' }), 'ANKI');
    }

    const mature = new Set(matureCards);
    const words: Record<string, number> = {};
    for (const note of notes) {
      const word = headwordOf(note?.fields, fieldName);
      if (!word) continue;
      const cards = Array.isArray(note?.cards) ? note.cards : [];
      // EVERY note in the deck enters the map: a word the deck holds is in
      // Anki, which is what `isInAnki` and the dedupe need. Maturity only
      // decides between the two sentinels, so a note with nothing but new
      // cards answers SEEN_DAYS (0) instead of disappearing.
      const days = cards.some((id) => mature.has(id)) ? MATURE_DAYS : SEEN_DAYS;
      const previous = words[word];
      if (previous === undefined || days > previous) words[word] = days;
    }
    return { ok: true, words };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'wordIntervals failed' };
  }
}
