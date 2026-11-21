/**
 * RED TESTS — round 10: saved-state consistency across the three surfaces.
 *
 * A PHRASE-LEVEL save is a scene, not vocabulary: it must never mark the
 * study store nor paint the lemma saved. And the transcript rail must honor
 * the SAME truth the overlay paints: `study.inAnki(lemma)` — not just the
 * one-shot savedWords fetch, which goes stale the moment a save or an undo
 * happens mid-session.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { TranscriptRail, type TranscriptRailProps } from '../../src/content/ui/TranscriptRail';
import type { StudyBinding } from '../../src/content/ui/study';

const SAVED_CLS = 'border-emerald-400/70';

describe('a phrase-level save paints NOTHING as saved', () => {
  it('one-word line saved through the plate path: phrase=true, no painted lemma', async () => {
    const onSaveCard = vi.fn(async (_t: string | undefined, _s: string, _l?: number, _g?: string, _p?: boolean) => ({ ok: true } as never));
    render(
      <SubtitleOverlay
        subtitleStyles={{} as never}
        // A ONE-word cue: the shortcut without a study binding saves the whole
        // plate — a LINE save, phrase-level, whose derived lemma IS the word.
        // This is the exact case where a phrase save wrongly painted the word.
        cue={{ id: 'c0', text: 'RUN', start: 0, end: 3000, language: 'en' }}
        altCue={null}
        mode="learning"
        saveRequestKey={1}
        onSaveCard={onSaveCard}
        onTokenHoverChange={() => {}}
        initialSavedWords={new Set()}
      />,
    );
    await vi.waitFor(() => expect(onSaveCard).toHaveBeenCalledTimes(1));
    expect(onSaveCard.mock.calls[0]?.[4]).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    const painted = Array.from(document.querySelectorAll<HTMLElement>('.kvl-tok'))
      .filter((el) => el.className.includes(SAVED_CLS));
    expect(painted).toHaveLength(0);
  });

  it('App never marks the study store for a phrase save (both recordCardSaved sites)', async () => {
    const fs = await import('node:fs');
    const lines = fs.readFileSync('src/content/ui/App.tsx', 'utf-8').split('\n');
    const callSites = lines.reduce<number[]>((acc, line, i) => {
      if (line.includes('recordCardSaved(lang, identity.key);')) acc.push(i);
      return acc;
    }, []);
    expect(callSites).toHaveLength(2);
    // EACH call site sits inside a phrase-level guard: no bare call remains.
    for (const site of callSites) {
      const guarded = lines
        .slice(Math.max(0, site - 3), site + 1)
        .some((l) => l.includes('if (!phraseLevel) {'));
      expect(guarded, `recordCardSaved at line ${site + 1} must be phrase-guarded`).toBe(true);
    }
  });

  it('a WORD save still paints its lemma (control case)', async () => {
    const onSaveCard = vi.fn(async (_t: string | undefined, _s: string, _l?: number, _g?: string, _p?: boolean) => ({ ok: true } as never));
    const { rerender } = render(
      <SubtitleOverlay
        subtitleStyles={{} as never}
        cue={{ id: 'c0', text: 'RUN is hard work', start: 0, end: 3000, language: 'en' }}
        altCue={null}
        mode="learning"
        onSaveCard={onSaveCard}
        onTokenHoverChange={() => {}}
        initialSavedWords={new Set(['run'])}
      />,
    );
    const run = screen.getByText('RUN');
    expect(run.className).toContain(SAVED_CLS);
    void rerender;
  });
});

describe('the transcript rail honors study.inAnki', () => {
  const railStudy: StudyBinding = {
    statusOf: () => 'new',
    detailOf: () => ({ status: 'new', source: 'estimated' } as never),
    setStatus: vi.fn(),
    // The Anki cache says this lemma has a card — the rail must agree.
    inAnki: (key: string) => key.toLowerCase() === 'rat',
    userStatusOf: () => undefined,
  };

  it('a line whose lemma is in Anki shows the saved glyph (savedWords empty)', () => {
    render(
      <TranscriptRail
        {...({ onSeek: vi.fn(), onReplay: vi.fn(), onReplaySlow: vi.fn(), autoPause: false } as unknown as TranscriptRailProps)}
        cues={[
          { id: 'a', start: 0, end: 3000, text: 'Hello there.', language: 'en' },
          { id: 'b', start: 3000, end: 6000, text: 'The rat ships frames.', language: 'en' },
        ]}
        // The saved glyph lives in the row's corner badge, which renders for
        // the ACTIVE row — point it at the rat line.
        activeIndex={1}
        lang="en"
        study={railStudy}
        newMarks="dotted"
        savedWords={new Set<string>()}
        nativeCues={null}
        translation="visible"
        onTranslationChange={vi.fn()}
        listenFirst={false}
        media={null}
        view="lines"
        onViewChange={vi.fn()}
      />,
    );
    const saved = screen.queryAllByTitle('Ya guardaste una tarjeta de esta frase');
    expect(saved.length).toBeGreaterThan(0);
  });

  it('the search control is reachable by its accessible name', () => {
    render(
      <TranscriptRail
        {...({ onSeek: vi.fn(), onReplay: vi.fn(), onReplaySlow: vi.fn(), autoPause: false } as unknown as TranscriptRailProps)}
        cues={[{ id: 'a', start: 0, end: 3000, text: 'Hello there.', language: 'en' }]}
        activeIndex={0}
        lang="en"
        study={railStudy}
        newMarks="dotted"
        savedWords={new Set<string>()}
        nativeCues={null}
        translation="visible"
        onTranslationChange={vi.fn()}
        listenFirst={false}
        media={null}
        view="lines"
        onViewChange={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Buscar en la transcripción' });
    fireEvent.click(button);
    void waitFor;
  });
});
