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
import { ankiConnect, AnkiConnectError, dataUrlToBase64, type AnkiCardInfo } from './anki-connect';

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

/** Word → interval (days), for the F5 word-status layer. */
export async function wordIntervals(
  deck: string,
  fieldName: string,
  mapping: AnkiMapping,
): Promise<AnkiWordIntervalsResponse> {
  if (!deck.trim() || !fieldName.trim()) return { words: {} };
  try {
    const cards = await ankiConnect.findCards(
      `deck:"${escapeAnkiSearchTerm(deck)}"`,
      mapping.ankiUrl,
      mapping.apiKey,
    );
    if (cards.length === 0) return { words: {} };
    const infos = await ankiConnect.cardsInfo(cards.slice(-5000), mapping.ankiUrl, mapping.apiKey);
    const words: Record<string, number> = {};
    for (const info of infos as AnkiCardInfo[]) {
      const field = info.fields[fieldName] ?? Object.values(info.fields)[0];
      const word = plainText(field?.value ?? '');
      if (!word) continue;
      words[word] = typeof info.interval === 'number' ? info.interval : 0;
    }
    return { words };
  } catch {
    return { words: {} };
  }
}