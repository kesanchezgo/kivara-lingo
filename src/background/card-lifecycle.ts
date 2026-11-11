/**
 * Card lifecycle commands: retry one, retry all, dismiss (docs/REDESIGN-V2.md
 * §4.6, H10).
 *
 * The engine queue (`pending_notes` in Dexie) still owns the retry timing; the
 * registry mirrors it. A card is linked to its pending row through
 * `request.cardId`, which the CREATE_CARD handler stamps on every request.
 */

import type {
  AnkiDeleteNoteResponse,
  AnkiMapping,
  CaptureSettings,
  CardDismissResponse,
  CardRetryAllResponse,
  CardRetryResponse,
  CreateCardRequest,
  MediaInfo,
} from '../shared/types';
import { beginRetry, isPending, mediaFromSource, type RecentCard } from '../shared/cards';
import { getDB } from '../shared/db';
import { profileLangOf, removeAnkiWord } from '../shared/study/wordStatus';
import { cardRegistry } from './card-registry';
import { createCardFromRequest, retryPendingNotes } from './capture-orchestrator';
import { deleteNote } from './card-actions';

function mappingForCard(mapping: AnkiMapping, card: RecentCard): AnkiMapping {
  return {
    ...mapping,
    deckName: card.deck || mapping.decks?.[card.lang] || mapping.deckName,
  };
}

function mediaForCard(card: RecentCard): MediaInfo | undefined {
  return mediaFromSource(card.source);
}

async function findPendingRow(
  cardId: string,
): Promise<{ id?: number; request: CreateCardRequest; retries: number; resolvedAudio?: { dataUrl: string; mime: string } | null } | undefined> {
  try {
    const rows = await getDB().pending_notes.toArray();
    return rows.find((row) => row.request?.cardId === cardId);
  } catch {
    return undefined;
  }
}

/** Retry one card immediately, ignoring its scheduled wait. */
export async function retryCard(
  id: string,
  mapping: AnkiMapping,
  capture: CaptureSettings,
): Promise<CardRetryResponse> {
  const card = await cardRegistry.get(id);
  if (!card) return { ok: false, error: 'unknown card' };
  if (card.status === 'saved') return { ok: true, noteId: card.noteId };

  await cardRegistry.patch(id, beginRetry(card));
  const effective = mappingForCard(mapping, card);
  const row = await findPendingRow(id);

  if (row?.id != null) {
    const request: CreateCardRequest = {
      ...row.request,
      cardId: id,
      deck: row.request.deck || card.deck,
      lang: row.request.lang ?? card.lang,
      language: row.request.lang ?? card.lang,
    };
    const result = await createCardFromRequest(request, effective, capture, {
      fromRetry: true,
      retryRowId: row.id,
      carriedAudio: row.resolvedAudio ?? null,
    });
    try {
      if (result.ok) {
        await getDB().pending_notes.delete(row.id);
      } else {
        const retries = row.retries + 1;
        await getDB().pending_notes.update(row.id, {
          retries,
          lastError: result.error ?? 'unknown',
          nextAttemptAt: Date.now() + Math.min(30 * 60_000, 60_000 * 2 ** retries),
        });
      }
    } catch {
      // best-effort: the registry already reflects the outcome
    }
    return { ok: result.ok, noteId: result.noteId, error: result.error };
  }

  // No queued row (permanent failure): rebuild the minimal request and let
  // the idempotency check decide whether the note already exists.
  const request: CreateCardRequest = {
    token: card.word,
    sentence: card.sentence,
    cardId: id,
    kind: card.kind,
    lang: card.lang,
    language: card.lang,
    deck: card.deck,
    media: mediaForCard(card),
  };
  const result = await createCardFromRequest(request, effective, capture, { fromRetry: true });
  if (!result.ok && result.queued) {
    // A manual retry that failed on transport still belongs to the alarm:
    // create the row the first attempt never had, so it is not stuck until
    // the user presses Retry again.
    try {
      await getDB().pending_notes.add({
        request,
        retries: 1,
        lastError: result.error ?? 'unknown',
        createdAt: Date.now(),
        nextAttemptAt: Date.now() + 60_000,
        resolvedAudio: null,
      });
    } catch {
      // best-effort
    }
  }
  return { ok: result.ok, noteId: result.noteId, error: result.error };
}

/** Retry every pending card now (manual "Retry all"). */
export async function retryAllCards(
  mapping: AnkiMapping,
  capture: CaptureSettings,
): Promise<CardRetryAllResponse> {
  const pending = (await cardRegistry.list()).filter(isPending);
  let retried = 0;
  let succeeded = 0;
  for (const card of pending) {
    retried += 1;
    const result = await retryCard(card.id, mapping, capture);
    if (result.ok) succeeded += 1;
  }
  // Legacy rows written before F4 carry no cardId: the engine drain still
  // owns them, and it is idempotent for cards already in the registry.
  await retryPendingNotes(mapping, capture);
  return { ok: succeeded === retried, retried, succeeded };
}

/**
 * Dismiss a pending/failed card: drop it from the registry and cancel its
 * queued row. A card dismissed while `sending` stays out because the registry
 * patch below no-ops after the record is gone.
 */
export async function dismissCard(id: string): Promise<CardDismissResponse> {
  await cardRegistry.remove(id);
  try {
    const rows = await getDB().pending_notes.toArray();
    const own = rows.filter((row) => row.request?.cardId === id);
    for (const row of own) {
      if (row.id != null) await getDB().pending_notes.delete(row.id);
    }
  } catch {
    // No queue readable: the registry removal is still the user's intent.
  }
  return { ok: true };
}

/**
 * Undo: delete the note in Anki, drop the registry row, and remove the word
 * from the F5 interval cache (`removeAnkiWord`) so it flips back to
 * «new/estimate» at once — the next refresh would remove it anyway, but a
 * deleted card must not read as «learning» until then. The registry row is
 * the only place that knows which language the card was saved for, so it is
 * read BEFORE the removal discards it. A note deleted by hand (`gone`) is
 * the same user goal and takes the same path.
 */
export async function undoDeleteNote(
  noteId: number,
  mapping: AnkiMapping,
): Promise<AnkiDeleteNoteResponse> {
  const known = await cardRegistry.findByNoteId(noteId);
  const result = await deleteNote(noteId, mapping);
  if (result.ok) {
    await cardRegistry.removeByNoteId(noteId);
    if (known) removeAnkiWord(profileLangOf(known.lang), known.word);
  }
  return result;
}
