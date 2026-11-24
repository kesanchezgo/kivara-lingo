/**
 * RED TESTS — manual QA follow-up (base main@086a315).
 * Rendered DOM contracts for the clipped card action bar and for the native
 * subtitle format options on BOTH caption surfaces.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WordPopover, type WordPopoverProps } from '../../src/content/ui/WordPopover';
import { SubtitleOverlay } from '../../src/content/ui/SubtitleOverlay';
import { App } from '../../src/content/ui/App';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import { t } from '../../src/shared/i18n';

afterEach(() => cleanup());

const cardProps: WordPopoverProps = {
  visible: true,
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  token: 'learning',
  lookupToken: 'learning',
  sentence: 'Aprendiendo en voz alta.',
  sourceLang: 'es',
  includeAi: false,
  kind: 'unknown',
  lemma: 'aprender',
  isExpanded: false,
  isSaved: false,
  parentMWE: null,
  onToggleExpand: () => {},
  onRejoinParent: () => {},
  onSave: () => {},
  wordStatus: 'learning',
  onWordStatus: () => {},
} as unknown as WordPopoverProps;

const overlayProps = (overrides: Partial<Parameters<typeof SubtitleOverlay>[0]> = {}) => ({
  subtitleStyles: {
    keepNativeLineBreaks: false,
    keepNativeAlignment: true,
    fontSize: 20,
    color: '#fff',
    bgOpacity: 0.7,
    position: 'bottom' as const,
    fontWeight: 500,
  } as never,
  cue: { id: 'c0', text: 'Primary line', start: 0, end: 3000, language: 'en', align: 'end' as const },
  altCue: { id: 'a0', text: 'Línea secundaria', start: 0, end: 3000, language: 'es', align: 'start' as const },
  mode: 'learning' as const,
  saveRequestKey: 0,
  onSaveCard: vi.fn(async () => ({ ok: true, noteId: 1 })),
  onTokenHoverChange: () => {},
  initialSavedWords: new Set<string>(),
  study: {
    statusOf: () => 'known' as const,
    detailOf: () => ({ status: 'known', source: 'estimated' } as never),
    setStatus: () => {},
    inAnki: () => false,
    userStatusOf: () => undefined,
  } as never,
  ...overrides,
});

describe('1 — word card action bar', () => {
  it('shrinks the status group and keeps the full Guardar action', () => {
    render(<WordPopover {...cardProps} />);
    const group = screen.getByRole('radiogroup');
    expect(group.className).toContain('min-w-0');
    expect(group.className).toContain('flex-1');
    expect(group.className).not.toContain('shrink-0');

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className, 'radio must be shrinkable').toContain('min-w-0');
      expect(radio.querySelector('span.truncate')).not.toBeNull();
    }

    const save = screen.getByRole('button', { name: t('wp.save') });
    expect(save.className).toContain('shrink-0');
    expect(save.className).toContain('min-w-[84px]');
  });
});

describe('2 — native subtitle format options', () => {
  it('honours each surface own alignment when keepNativeAlignment is on', () => {
    render(<div data-popover-boundary><SubtitleOverlay {...overlayProps()} /></div>);
    const plate = document.querySelector<HTMLElement>('[data-kivara-caption-box]')!;
    const dual = document.querySelector<HTMLElement>('[data-kivara-dual]')!;
    expect(plate).not.toBeNull();
    expect(dual).not.toBeNull();
    expect(plate.style.textAlign).toBe('right');
    expect(dual.style.textAlign).toBe('left');
  });

  it('applies the line-break toggle to the secondary line too', () => {
    const props = overlayProps({
      cue: { id: 'c0', text: 'First\nSecond', start: 0, end: 3000, language: 'en' },
      altCue: { id: 'a0', text: 'Primera\nSegunda', start: 0, end: 3000, language: 'es' },
    });
    const collapsed = render(<div data-popover-boundary><SubtitleOverlay {...props} /></div>);
    expect(document.querySelector('[data-kivara-caption-box]')?.textContent).not.toContain('\n');
    expect(document.querySelector('[data-kivara-dual]')?.textContent).not.toContain('\n');
    collapsed.unmount();

    const kept = overlayProps({
      subtitleStyles: {
        keepNativeLineBreaks: true,
        keepNativeAlignment: false,
        fontSize: 20,
        color: '#fff',
        bgOpacity: 0.7,
        position: 'bottom' as const,
        fontWeight: 500,
      } as never,
      cue: props.cue,
      altCue: props.altCue,
    });
    render(<div data-popover-boundary><SubtitleOverlay {...kept} /></div>);
    const plate = document.querySelector<HTMLElement>('[data-kivara-caption-box]')!;
    const dual = document.querySelector<HTMLElement>('[data-kivara-dual]')!;
    expect(plate.textContent).toContain('\n');
    expect(dual.textContent).toContain('\n');
    expect(plate.style.whiteSpace).toBe('pre-line');
    expect(dual.style.whiteSpace).toBe('pre-line');
  });

  it('forwards each cue align from the adapter through App to both lines', async () => {
    await useKivaraStore.persist.rehydrate();
    useKivaraStore.setState({
      enabled: true,
      subtitleStyles: {
        ...useKivaraStore.getState().subtitleStyles,
        keepNativeAlignment: true,
      },
      translate: { ...useKivaraStore.getState().translate, targetLanguage: 'es' },
    });
    let emit: ((cues: unknown[]) => void) | null = null;
    const adapter = {
      platform: 'netflix',
      hideNativeSubtitles: () => {},
      showNativeSubtitles: () => {},
      onCueChange: (cb: (cues: unknown[]) => void) => { emit = cb; return () => {}; },
      getAltCueAt: () => ({
        id: 'a0', text: 'Línea secundaria', start: 0, end: 3000, language: 'es', align: 'start',
      }),
      playback: null,
    } as unknown as Parameters<typeof App>[0]['adapter'];
    const overlayRoot = document.createElement('div');
    document.body.append(overlayRoot);
    render(
      <App
        adapter={adapter}
        videoElement={document.createElement('video')}
        videoOverlayRoot={overlayRoot}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      useKivaraStore.setState({
        enabled: true,
        subtitleStyles: {
          ...useKivaraStore.getState().subtitleStyles,
          keepNativeAlignment: true,
        },
        translate: { ...useKivaraStore.getState().translate, targetLanguage: 'es' },
      });
      emit!([{ id: 'c0', text: 'Primary line', start: 0, end: 3000, language: 'en', align: 'end' }]);
    });
    const plate = document.querySelector<HTMLElement>('[data-kivara-caption-box]')!;
    const dual = document.querySelector<HTMLElement>('[data-kivara-dual]')!;
    expect(useKivaraStore.getState().subtitleStyles.keepNativeAlignment).toBe(true);
    expect(plate).not.toBeNull();
    expect(dual).not.toBeNull();
    expect(plate.style.textAlign).toBe('right');
    expect(dual.style.textAlign).toBe('left');
  });
});
