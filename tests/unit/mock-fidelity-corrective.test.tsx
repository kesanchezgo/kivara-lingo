/**
 * RED TESTS — corrective PR against 2e2ab16.
 * Executable DOM contracts for the real PlayerBar, shared caption box,
 * offset-safe caption text and canonical LRU translation cache.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerBar } from '../../src/content/ui/PlayerBar';
import { t } from '../../src/shared/i18n';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import {
  clearTranslationCache, readTranslation, rememberTranslation, translationCacheKey,
} from '../../src/content/ui/translation-cache';

afterEach(() => cleanup());

const barProps = () => ({
  playing: false,
  duration: 60_000,
  autoPauseCue: false,
  loopCue: false,
  speed: 1,
  railOpen: false,
  panelOpen: false,
  onTogglePlay: vi.fn(),
  onPrev: vi.fn(),
  onReplay: vi.fn(),
  onReplaySlow: vi.fn(),
  onNext: vi.fn(),
  onToggleAutoPause: vi.fn(),
  onToggleLoop: vi.fn(),
  onSpeed: vi.fn(),
  onToggleRail: vi.fn(),
  onTogglePanel: vi.fn(),
  onSeek: vi.fn(),
  onWakeNative: vi.fn(),
});

describe('PlayerBar real controls', () => {
  it('seeks through the adapter from the slider, never writing video.currentTime', () => {
    const video = document.createElement('video');
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    const setter = vi.fn(original.set);
    Object.defineProperty(video, 'currentTime', { get: () => 0, set: setter, configurable: true });
    const props = { ...barProps(), video };
    render(<PlayerBar {...props} />);

    const slider = screen.getByRole('slider', { name: t('player.seek') });
    expect(slider.getAttribute('aria-valuemax')).toBe('60000');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(props.onSeek).toHaveBeenCalledWith(5_000);
    expect(setter).not.toHaveBeenCalled();
  });

  it('mutes and changes real volume', () => {
    const video = document.createElement('video');
    const props = { ...barProps(), video };
    render(<PlayerBar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: t('player.mute') }));
    expect(video.muted).toBe(true);
    fireEvent.change(screen.getByRole('slider', { name: t('player.volume') }), { target: { value: '0.4' } });
    expect(video.volume).toBeCloseTo(0.4);
  });

  it('wakes native Netflix controls before forwarding CC', async () => {
    const props = barProps();
    render(<PlayerBar {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('player.netflixSubtitles') }));
    });
    expect(props.onWakeNative).toHaveBeenCalled();
  });

  it('hides after inactivity and wakes on pointer movement', async () => {
    vi.useFakeTimers();
    const props = { ...barProps(), playing: true };
    const { container } = render(<PlayerBar {...props} />);
    const bar = container.querySelector('[data-kvl-player-bar]')!;
    expect(bar.className).not.toContain('opacity-0');
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(bar.className).toContain('opacity-0');
    await act(async () => { fireEvent.pointerMove(window); });
    expect(bar.className).not.toContain('opacity-0');
    vi.useRealTimers();
  });
});

describe('caption box, offsets and cache', () => {
  it('keeps line spans indexed into the exact rendered caption text', async () => {
    const { cueLineSpansExact } = await import('../../src/content/ui/save-request');
    const text = 'Primera  frase  \n\nSegunda línea';
    const spans = cueLineSpansExact(text);
    for (const span of spans) {
      expect(text.slice(span.start, span.end), JSON.stringify(span)).toBe(span.text);
    }
    expect(spans).toHaveLength(2);
  });


  it('gives primary and dual lines one shared full-width box', () => {
    render(<div data-popover-boundary><SubtitleOverlay
      subtitleStyles={{ keepNativeLineBreaks: true, keepNativeAlignment: true, fontSize: 20, color: '#fff', bgOpacity: 0.7, position: 'bottom', fontWeight: 500 } as never}
      cue={{ id: 'c', text: 'First line', start: 0, end: 3000, language: 'en', align: 'end' }}
      altCue={{ id: 'a', text: 'Segunda línea', start: 0, end: 3000, language: 'es', align: 'start' }}
      mode="learning"
      saveRequestKey={0}
      onSaveCard={vi.fn(async () => ({ ok: true, noteId: 1 }))}
      onTokenHoverChange={() => {}}
      initialSavedWords={new Set()}
      study={{ statusOf: () => 'known', detailOf: () => ({ status: 'known', source: 'estimated' } as never), setStatus: () => {}, inAnki: () => false, userStatusOf: () => undefined } as never}
    /></div>);
    const plate = document.querySelector<HTMLElement>('[data-kivara-caption-box]')!;
    const dual = plate.querySelector<HTMLElement>('[data-kivara-dual]')!;
    // PR #167 made the plate INTRINSIC. `toContain('w-full')` was a false
    // positive: `w-fit max-w-full` contains the substring "w-full" inside
    // "max-w-full", so the assertion passed while proving the opposite.
    expect(plate.classList.contains('w-fit'), 'the plate hugs its text').toBe(true);
    expect(plate.classList.contains('w-full'), 'the plate never spans the player').toBe(false);
    expect(dual.parentElement).toBe(plate);
    expect(plate.style.textAlign).toBe('right');
    expect(dual.style.textAlign).toBe('left');
  });

  it('uses a canonical composite key, LRU eviction and clean language invalidation', () => {
    clearTranslationCache();
    expect(translationCacheKey('Hola', 'es-ES', 'en-US')).toBe(translationCacheKey('Hola', 'es', 'en'));
    rememberTranslation('Hola', 'es', 'en', { ok: true, translatedText: 'Hello' } as never);
    expect(readTranslation('Hola', 'es-ES', 'en-US')).toBe('Hello');
    expect(readTranslation('Hola', 'en', 'es')).toBeNull();
    clearTranslationCache();
    expect(readTranslation('Hola', 'es', 'en')).toBeNull();
  });
});
