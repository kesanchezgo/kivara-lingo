/**
 * RED TESTS — Block B wiring audit (base main@81c584f).
 *
 * These mount the real <App /> (or the real closed-root hitmap writer) and
 * assert rendered DOM: the docked panel's transcript hand-off, a live floating
 * panel that keeps its active tab, the rail's exit animation, the player's
 * motion stylesheet, and the E2E state's closing-node filter. Every case fails
 * on 81c584f before the production changes.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/content/ui/App';
import { SlideColumn } from '../../src/content/ui/SlideColumn';
import { railOpenStore } from '../../src/content/ui/ui-state';
import { computeColumnLayout, STUDY_COLUMN_WIDTH_PX } from '../../src/content/ui/columns-css';
import { defaultPopupPosition } from '../../src/content/ui/default-popup-position';
import { publishAllRoots } from '../../src/content/ui/e2e-hitmap';
import { __registerShadowRootForTests } from '../../src/content/shadow-host';
import { useKivaraStore } from '../../src/shared/use-kivara-store';
import { t } from '../../src/shared/i18n';

type RenderState = { railOpen?: boolean; panelOpen?: boolean; isPopupMode?: boolean };

async function settle(ms = 50): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function renderApp(
  state: RenderState = {},
  adapter: Parameters<typeof App>[0]['adapter'] = null,
) {
  useKivaraStore.setState({
    enabled: true,
    panelOpen: state.panelOpen ?? false,
    isPopupMode: state.isPopupMode ?? false,
    panelPosition: null,
  });
  // Writes before hydration are queued by the chrome-local store; hydrate
  // first so the rail state is live on the very first App render.
  await railOpenStore.hydrate();
  railOpenStore.set(state.railOpen ?? false);
  const videoOverlayRoot = document.createElement('div');
  document.body.append(videoOverlayRoot);
  return render(
    <App
      adapter={adapter}
      videoElement={document.createElement('video')}
      videoOverlayRoot={videoOverlayRoot}
    />,
  );
}

function tabByLabel(label: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
    .find((tab) => tab.textContent?.includes(label)) ?? null;
}

function activeTabIn(root: ParentNode | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null;
}

function dockedPanel(): HTMLElement | null {
  return document.querySelector('[data-kvl-panel-to-rail]')?.closest<HTMLElement>('[role="complementary"]') ?? null;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const style of Array.from(document.querySelectorAll('style[id^="kivara-columns-"], style[id^="kivara-col-motion-"]'))) {
    style.remove();
  }
  document.documentElement.removeAttribute('data-kvl-columns');
  vi.unstubAllGlobals();
});

describe('B1 — real SlideColumn animation and coupled container', () => {
  it('starts an initially open column at 0px and grows to the target width', async () => {
    const view = render(
      <SlideColumn open widthPx={STUDY_COLUMN_WIDTH_PX}><div data-testid="lazy-rail">rail</div></SlideColumn>,
    );
    const outer = screen.getByTestId('lazy-rail').parentElement!.parentElement!;
    expect(outer.className).toContain('w-0');
    expect(outer.style.width).toBe('');

    await settle();
    // PR #170: ONE study-column width for both columns (420).
    expect(outer.style.width).toBe(`${STUDY_COLUMN_WIDTH_PX}px`);
    view.unmount();
  });

  it('keeps a stable accessible name on the Cards tab despite its pending badge', async () => {
    const { unmount } = await renderApp({ panelOpen: true });
    const cards = tabByLabel(t('panel.tabCards'));
    expect(cards).not.toBeNull();
    expect(cards!.getAttribute('aria-label')).toBe(t('panel.tabCards'));
    unmount();
  });

  it('offers the transcript button when the panel is docked and focuses the BrandGlyph', async () => {
    const { unmount } = await renderApp({ panelOpen: true, railOpen: true });
    const toRail = document.querySelector<HTMLButtonElement>('[data-kvl-panel-to-rail]');
    expect(toRail).not.toBeNull();

    fireEvent.click(toRail!);
    await settle();
    expect(toRail!.closest('[data-kvl-closing]')).not.toBeNull();

    const brand = document.querySelector<HTMLElement>('[data-kvl-rail-to-panel]');
    expect(brand).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(brand));
    unmount();
  });

  it('keeps a floating panel alive outside the closing column, with its tab and rail reserve', async () => {
    const { unmount } = await renderApp({ panelOpen: true, railOpen: true });
    const settingsTab = tabByLabel(t('panel.tabSettings'));
    expect(settingsTab).not.toBeNull();
    fireEvent.click(settingsTab!);
    expect(activeTabIn(dockedPanel())?.textContent).toContain(t('panel.tabSettings'));

    fireEvent.click(screen.getByTitle(t('panel.openFloating')));
    await settle(80);

    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('[data-kvl-closing]')).toBeNull();
    expect(document.querySelector('[data-kvl-rail-to-panel]')).not.toBeNull();
    expect(activeTabIn(dialog)?.textContent).toContain(t('panel.tabSettings'));
    // The popup sits left of the rail's REAL reserve: at a narrow viewport the
    // 420px column is scaled down by the 40% cap, so the assertion asks the
    // layout instead of assuming the preferred width.
    const railReserve = computeColumnLayout({ rail: true, panel: false }, window.innerWidth).railWidth;
    expect(railReserve).toBeGreaterThan(0);
    expect(dialog.style.left).toBe(`${defaultPopupPosition(railReserve).left}px`);
    unmount();
  });

  it('keeps the rail mounted with data-kvl-closing until its exit transition ends', async () => {
    const { unmount } = await renderApp({ railOpen: true });
    const brand = document.querySelector<HTMLElement>('[data-kvl-rail-to-panel]');
    expect(brand).not.toBeNull();
    const close = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.title.includes(t('rail.close')));
    expect(close).not.toBeNull();

    fireEvent.click(close!);
    await settle(30);
    expect(brand!.isConnected).toBe(true);
    expect(brand!.closest('[data-kvl-closing]')).not.toBeNull();

    await settle(400);
    expect(document.querySelector('[data-kvl-rail-to-panel]')).toBeNull();
    unmount();
  });
});

describe('B3 — player motion and E2E closing filter', () => {
  it('mounts the motion stylesheet from App with width, max-width and right', async () => {
    const netflix = {
      platform: 'netflix',
      hideNativeSubtitles: vi.fn(),
      showNativeSubtitles: vi.fn(),
      onCueChange: () => () => {},
      playback: null,
    } as unknown as Parameters<typeof App>[0]['adapter'];
    const { unmount } = await renderApp({ railOpen: true }, netflix);
    const motion = document.getElementById('kivara-col-motion-netflix');
    expect(motion).not.toBeNull();
    const css = motion!.textContent ?? '';
    for (const property of ['width', 'max-width', 'right']) {
      expect(css, property).toContain(`${property} 300ms cubic-bezier(.32, .72, 0, 1)`);
    }
    expect(css).toContain('prefers-reduced-motion');
    unmount();
  });

  it('does not publish cue rows or tabpanels from a closing column', async () => {
    const host = document.createElement('div');
    host.id = 'kivara-lingo-video-host';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    __registerShadowRootForTests(host, root);

    const closing = document.createElement('div');
    closing.setAttribute('data-kvl-closing', '');
    closing.innerHTML = '<div data-kvl-cue="0"><div role="button"><p>LINEA CERRADA</p></div></div>'
      + '<div role="tabpanel">PANEL CERRADO</div>';
    const live = document.createElement('div');
    live.innerHTML = '<div data-kvl-cue="1"><div role="button"><p>LINEA VIVA</p></div></div>'
      + '<div role="tabpanel">PANEL VIVO</div>';
    root.append(closing, live);

    const stop = publishAllRoots();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const raw = host.getAttribute('data-kivara-e2e-state');
    expect(raw).not.toBeNull();
    const state = JSON.parse(raw!) as { rows: Array<{ text: string }>; text: string };
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].text).toBe('LINEA VIVA');
    expect(state.text).toContain('PANEL VIVO');
    expect(state.text).not.toContain('PANEL CERRADO');
    stop();
  });
});
