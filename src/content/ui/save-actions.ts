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
  CreateCardErrorCode,
  CreateCardKind,
} from '../../shared/types';
import { CARD_ERROR_LABEL_KEYS } from '../../shared/card-errors';
import { originLabel, type CardSource } from '../../shared/study/cardTags';
import { showSavedToast } from './CardToasts';

/**
 * Fired after a successful undo. The overlay listens for it to drop its local
 * green "saved" mark: the registry row and the interval cache are already
 * handled by the service worker, but the token's own view state lives here.
 */
export const CARD_UNDONE_EVENT = 'kivara-card-undone';

/**
 * Fired when a notice offers "View queue". App opens the panel and the panel
 * listens for this to land on the Cards tab, the one that owns the retry
 * queue — the tab is local state there, so the event is the seam.
 */
export const OPEN_CARDS_EVENT = 'kivara-open-cards';

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
  /** Where the scene comes from, for the "already in your deck" copy. */
  origin?: CardSource;
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

/**
 * "How to turn sentence audio on" is worth saying ONCE per session: the
 * prototype spends the first missing-audio card on the instruction and every
 * later one on the plain "no sentence audio" line. Module state, not storage —
 * a new page load is a new session.
 */
let audioHintShown = false;

/** Test seam: forget that the hint was already shown. */
export function resetAudioHintForTests(): void {
  audioHintShown = false;
}

/** True the first time it is called in a session, false afterwards. */
export function takeAudioHintOnce(): boolean {
  if (audioHintShown) return false;
  audioHintShown = true;
  return true;
}

/**
 * Sentence-audio advice for the "card saved" notice.
 *
 * The service worker reports a missing track as `capture.audioInactive`
 * whenever capture was off. The first such card of the session explains how
 * to turn capture on (naming the save combo when the user has one); later
 * cards get the plain `app.noAudio` line, and nothing is said at all while
 * capture is active — then the warning, if any, is a real failure.
 */
export function withAudioHint(
  warnings: string[],
  opts: { audioCaptureActive: boolean; combo?: string },
): string[] {
  const marker = t('capture.audioInactive');
  const index = warnings.indexOf(marker);
  if (opts.audioCaptureActive || index < 0) return warnings;
  const line = takeAudioHintOnce()
    ? (opts.combo ? t('app.noAudioHint', { combo: opts.combo }) : t('app.noAudioHintNoKey'))
    : t('app.noAudio');
  return [...warnings.slice(0, index), line, ...warnings.slice(index + 1)];
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
  onViewQueue?: () => void,
  errorCode?: CreateCardErrorCode,
): void {
  const raw = detail?.trim();
  // When the worker classified the failure, the CODE names the family in the
  // user's language; the provider sentence stays as a secondary detail because
  // it is usually technical (and often English) and reads as noise alone.
  const label = errorCode ? t(CARD_ERROR_LABEL_KEYS[errorCode]) : '';
  const reason = label
    ? (raw && raw !== label ? `${label} — ${raw}` : label)
    : (raw || t('popup.anki.down'));
  // "View queue" only makes sense for a card that IS queued: it lands on the
  // Cards tab, where the retry queue and its "retry now" live.
  const action = queued && onViewQueue
    ? { label: t('queue.viewQueue'), onClick: onViewQueue }
    : undefined;
  toast.error(t('app.ankiSaveError'), {
    id,
    description: queued ? `${reason} ${t('queue.willRetry')}` : reason,
    ...(action ? { action } : {}),
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
    // The worker answers `already` when nothing new landed: the sentence was
    // on the note and no media or tags arrived. Saying "added" then would be
    // a lie the user can verify by opening the card.
    if (res.already) {
      toast.message(t('queue.contextAlready'), { description: ctx.token, duration: 1800 });
      return true;
    }
    const missing = sceneMediaNotes(media);
    const where = originLabel(ctx.origin);
    toast.success(t('queue.contextAdded'), {
      description: [
        where ? t('queue.contextAddedBody', { word: ctx.token, where }) : ctx.token,
        ...missing,
      ].join(' · '),
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
