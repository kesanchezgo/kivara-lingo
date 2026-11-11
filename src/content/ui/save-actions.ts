/**
 * Overlay save notices and the "Add this scene" action (docs/REDESIGN-V2.md
 * §4.6, §5.1) — the orchestration the prototype kept in `showSavedToast` and
 * the word popover's `onAddContext`.
 *
 * The service worker owns every state transition: undo deletes the note via
 * `ANKI_DELETE_NOTE` (which also drops the registry row and the F5 interval
 * cache), and adding a scene goes through `ANKI_ADD_CONTEXT`. This module only
 * builds the request, captures the scene's media and surfaces the outcome, so
 * the views never need a second copy of that logic.
 */
import { toast } from 'sonner';
import { sendMessage } from 'webext-bridge/content-script';
import { t } from '../../shared/i18n';
import type {
  AnkiAddContextRequest,
  AnkiAddContextResponse,
  AnkiDeleteNoteResponse,
  CreateCardKind,
} from '../../shared/types';
import { showSavedToast } from './CardToasts';

/**
 * Fired after a successful undo. The overlay listens for it to drop its local
 * green "saved" mark: the registry row and the interval cache are already
 * handled by the service worker, but the token's own view state lives here.
 */
export const CARD_UNDONE_EVENT = 'kivara-card-undone';

/** The card flavour a saved token produces: one token vs. a multi-word span. */
export function cardKindOf(text: string): CreateCardKind {
  return text.trim().split(/\s+/).filter(Boolean).length > 1 ? 'expression' : 'word';
}

/** What the "Add this scene" call needs to know about the card it refers to. */
export interface SceneContext {
  /** The real headword of the card (the same token the save sent). */
  token: string;
  /** The real sentence attached to that card. */
  sentence: string;
  /** The actual card kind, so the tags match the note (never a default). */
  kind: CreateCardKind;
  deck: string;
  /** Field that holds the headword, used to resolve the note. */
  fieldName?: string;
  tags: string[];
}

/** Frame + sentence audio captured for a scene. Both are optional by design. */
export interface SceneMedia {
  frame?: string;
  audio?: string;
}

/** The note a save produced, as the toast needs it. */
export interface SavedNote {
  noteId?: number;
  text: string;
  deck: string;
}

/** What is missing from a scene, in the prototype's wording (amber notes). */
export function sceneMediaNotes(media: SceneMedia): string[] {
  if (media.frame && media.audio) return [];
  if (!media.frame && !media.audio) return [t('app.noMedia')];
  if (!media.frame) return [t('app.noFrame')];
  return [t('app.noAudio')];
}

/**
 * Undo a save: delete the note through the service worker path that also
 * removes the registry row and the interval-cache entry. A failed delete is
 * surfaced with its reason; a successful one drops the overlay's saved mark.
 */
export async function undoSavedNote(noteId: number, text: string): Promise<boolean> {
  let res: AnkiDeleteNoteResponse | undefined;
  try {
    res = (await sendMessage(
      'ANKI_DELETE_NOTE',
      { noteId },
      'background',
    )) as AnkiDeleteNoteResponse;
  } catch (err) {
    res = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (res?.ok) {
    toast(t('queue.undone'), { description: text, duration: 2400 });
    window.dispatchEvent(
      new CustomEvent(CARD_UNDONE_EVENT, { detail: { token: text } }),
    );
    return true;
  }
  toast.error(t('queue.undoFailed'), {
    description: res?.error ?? t('popup.anki.down'),
  });
  return false;
}

/**
 * "Card saved" notice. Undo is only offered when the note id is known —
 * without it there is nothing to delete, and a dead button reads worse than
 * no button. `notes` are the save's warnings (missing media, enrichment).
 */
export function showCardSaved(card: SavedNote, notes: string[] = []): void {
  const noteId = card.noteId;
  showSavedToast(
    { id: noteId != null ? String(noteId) : card.text, text: card.text, deck: card.deck },
    noteId != null ? () => void undoSavedNote(noteId, card.text) : undefined,
    notes,
  );
}

/**
 * Failed save, in the prototype's copy: the localized title plus the reason.
 * `queued` means the card is waiting in the retry queue, not lost.
 */
export function showCardSaveError(
  detail?: string,
  queued = false,
  id?: string | number,
): void {
  const reason = detail?.trim() || t('popup.anki.down');
  toast.error(t('app.ankiSaveError'), {
    id,
    description: queued ? `${reason} ${t('queue.willRetry')}` : reason,
    duration: 6000,
  });
}

/**
 * Attach this scene (sentence, frame, audio, tags) to the note the card
 * already has. Capturing is best-effort, exactly like the save path: a failed
 * or partial capture never blocks the update — the note is still written, and
 * the success notice lists what could not be recorded.
 */
export async function addSceneToNote(
  ctx: SceneContext,
  capture: () => Promise<SceneMedia>,
): Promise<boolean> {
  let media: SceneMedia = {};
  try {
    media = await capture();
  } catch {
    // Capture is optional: send the context without it.
    media = {};
  }

  const request: AnkiAddContextRequest = {
    token: ctx.token,
    sentence: ctx.sentence,
    deck: ctx.deck,
    fieldName: ctx.fieldName,
    tags: ctx.tags,
    frame: media.frame,
    audio: media.audio,
  };

  let res: AnkiAddContextResponse | undefined;
  try {
    res = (await sendMessage(
      'ANKI_ADD_CONTEXT',
      request,
      'background',
    )) as AnkiAddContextResponse;
  } catch (err) {
    res = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (res?.ok) {
    const missing = sceneMediaNotes(media);
    toast.success(t('queue.contextAdded'), {
      description: missing.length > 0 ? `${ctx.token} · ${missing.join(' · ')}` : ctx.token,
      duration: 3000,
    });
    return true;
  }
  // The fields landed but the tags did not: the scene is there, so this is a
  // warning — not the "couldn't add" error, which would be a lie.
  if (res?.partial === 'tags') {
    toast.warning(t('app.addScenePartialTags'), {
      description: res.error ?? ctx.token,
      duration: 4000,
    });
    return true;
  }
  toast.error(t('app.addSceneError'), { description: res?.error ?? t('popup.anki.down') });
  return false;
}
