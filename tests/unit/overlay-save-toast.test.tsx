/**
 * Overlay save notices: the prototype's «Tarjeta guardada» toast, its Undo and
 * the «Añadir esta escena» action.
 *
 * The service worker is out of unit range, so this renders the real toast JSX
 * (captured from `toast.custom`) and drives the same module App calls. What is
 * under test is the behaviour the review listed: Undo only with a note id, the
 * delete sent over the bridge, the failure surfaced, the scene's frame/audio,
 * the localized copy and the real kind/word travelling in the request.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import { sendMessage } from 'webext-bridge/content-script';
import { t } from '../../src/shared/i18n';
import { buildCardTags } from '../../src/shared/cards';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import {
  addSceneToNote,
  showCardSaved,
  showCardSaveError,
  undoSavedNote,
  type SceneContext,
} from '../../src/content/ui/save-actions';
import type { CreateCardKind } from '../../src/shared/types';

vi.mock('sonner', () => {
  // Sonner's `toast` is callable AND carries the helpers; the mock keeps both
  // shapes so `toast(...)` and `toast.error(...)` are both observable.
  const toast = vi.fn();
  Object.assign(toast, {
    custom: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

afterEach(() => {
  cleanup();
  vi.mocked(sendMessage).mockReset();
});

beforeEach(() => {
  vi.mocked(sendMessage).mockResolvedValue({} as never);
});

/** Render the saved notice App shows and return the rendered view. */
function renderSavedToast(noteId: number | undefined) {
  showCardSaved({ noteId, text: 'hello', deck: 'English' });
  const calls = vi.mocked(toast.custom).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const renderFn = calls[calls.length - 1][0] as (id: string) => React.ReactElement;
  return render(renderFn('save-toast'));
}

function undoButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: new RegExp(t('recent.undo')) });
}

const SCENE: SceneContext = {
  token: 'hello',
  sentence: 'Hello there, general.',
  kind: 'word',
  deck: 'English',
  fieldName: 'Front',
  tags: buildCardTags('word', undefined, 'en'),
};

describe('saved toast undo', () => {
  it('offers Undo when the save returned a note id', () => {
    renderSavedToast(42);
    expect(undoButton()).not.toBeNull();
  });

  it('shows no Undo when the note id is unknown', () => {
    renderSavedToast(undefined);
    // The toast still renders (the card is saved); only the action is absent.
    expect(screen.getByText(t('app.cardSaved'))).not.toBeNull();
    expect(undoButton()).toBeNull();
  });

  it('sends ANKI_DELETE_NOTE with the note the save produced', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true } as never);
    renderSavedToast(42);
    fireEvent.click(undoButton()!);
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        'ANKI_DELETE_NOTE',
        { noteId: 42 },
        'background',
      );
    });
  });

  it('surfaces the reason when Undo fails', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: false, error: 'Anki closed' } as never);
    renderSavedToast(42);
    fireEvent.click(undoButton()!);
    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        t('queue.undoFailed'),
        expect.objectContaining({ description: 'Anki closed' }),
      );
    });
  });

  it('drops the overlay’s saved mark after a successful undo', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true } as never);
    render(
      <SubtitleOverlay
        subtitleStyles={{} as never}
        cue={{ id: 'c0', text: 'hello', start: 0, end: 3000, language: 'en' }}
        altCue={null}
        mode="learning"
        saveRequestKey={null}
        onSaveCard={vi.fn(async () => ({ ok: true }))}
        onTokenHoverChange={() => {}}
        initialSavedWords={new Set(['hello'])}
      />,
    );
    expect(screen.queryByText('hello')!.className).toContain('border-emerald');
    await act(async () => {
      await undoSavedNote(42, 'hello');
    });
    expect(screen.queryByText('hello')!.className).not.toContain('border-emerald');
  });
});

describe('failed save copy', () => {
  it('uses the localized prototype copy with the reason', () => {
    showCardSaveError('AnkiConnect not responding');
    expect(toast.error).toHaveBeenCalledWith(
      t('app.ankiSaveError'),
      expect.objectContaining({ description: 'AnkiConnect not responding' }),
    );
  });

  it('says the card waits in the retry queue when it was queued', () => {
    showCardSaveError('AnkiConnect not responding', true);
    expect(toast.error).toHaveBeenCalledWith(
      t('app.ankiSaveError'),
      expect.objectContaining({
        description: `AnkiConnect not responding ${t('queue.willRetry')}`,
      }),
    );
  });
});

describe('add this scene', () => {
  it('carries the captured frame and sentence audio', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, noteId: 7 } as never);
    const ok = await addSceneToNote(SCENE, async () => ({
      frame: 'data:image/jpeg;base64,AAAA',
      audio: 'data:audio/mp3;base64,BBBB',
    }));
    expect(ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      'ANKI_ADD_CONTEXT',
      expect.objectContaining({
        token: 'hello',
        sentence: 'Hello there, general.',
        deck: 'English',
        fieldName: 'Front',
        tags: SCENE.tags,
        frame: 'data:image/jpeg;base64,AAAA',
        audio: 'data:audio/mp3;base64,BBBB',
      }),
      'background',
    );
    expect(toast.success).toHaveBeenCalledWith(
      t('queue.contextAdded'),
      expect.objectContaining({ description: 'hello' }),
    );
  });

  it('still adds the sentence when the capture fails, without media', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, noteId: 7 } as never);
    const ok = await addSceneToNote(SCENE, async () => {
      throw new Error('no frame');
    });
    expect(ok).toBe(true);
    const payload = vi.mocked(sendMessage).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.token).toBe('hello');
    expect(payload.sentence).toBe('Hello there, general.');
    expect(payload.frame).toBeUndefined();
    expect(payload.audio).toBeUndefined();
    // Soft warning: the note was updated, the toast says what is missing.
    expect(toast.success).toHaveBeenCalledWith(
      t('queue.contextAdded'),
      expect.objectContaining({
        description: expect.stringContaining(t('app.noMedia')),
      }),
    );
  });

  it('travels the real kind: an expression builds expression tags', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, noteId: 7 } as never);
    const kind: CreateCardKind = 'expression';
    const expression: SceneContext = {
      ...SCENE,
      token: 'give up',
      sentence: 'Never give up.',
      kind,
      tags: buildCardTags(kind, undefined, 'en'),
    };
    await addSceneToNote(expression, async () => ({}));
    const payload = vi.mocked(sendMessage).mock.calls[0][1] as {
      token: string;
      tags: string[];
    };
    expect(payload.token).toBe('give up');
    expect(payload.tags).toContain('kivara::expression');
    expect(payload.tags).not.toContain('kivara::word');
  });

  it('reports a failed update with its reason', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: false, error: 'note not found' } as never);
    const ok = await addSceneToNote(SCENE, async () => ({}));
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      t('app.addSceneError'),
      expect.objectContaining({ description: 'note not found' }),
    );
  });
});
