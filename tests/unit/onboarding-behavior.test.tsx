
/**
 * Behavioral characterization of the Onboarding ROOT, rendered for real
 * in happy-dom. It pins the visible stepper flow and both nontrivial
 * locks: Anki stays blocked while pinging or errored, and mapping stays
 * blocked unless both a deck and note model are selected.
 *
 * The test pins the locale through tests/setup.ts (Spanish), then uses
 * stable data-testid/aria-current markers instead of Tailwind classes or
 * button position. It also resets the Zustand singleton and bridge mocks
 * around every case, so hydration and one test's chrome stub cannot leak
 * into the next case.
 *
 * 20 s per case, not Vitest's default 5: this file mounts the whole settings
 * bridge (store, chrome mock, writes before render) and a default timeout
 * there fails under machine load, which loses the signal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { sendMessage } from 'webext-bridge/options';

vi.mock('webext-bridge/options', () => ({
  sendMessage: vi.fn(),
}));
import {
  useKivaraStore,
  DEFAULT_ANKI_MAPPING,
  DEFAULT_AI,
  DEFAULT_CAPTURE,
  DEFAULT_CLEANUP,
  DEFAULT_ONBOARDING,
  DEFAULT_SUBTITLE_STYLES,
  DEFAULT_TRANSLATE,
  DEFAULT_ASR,
  DEFAULT_VIP,
  DEFAULT_TTS,
  DEFAULT_TELEMETRY,
  DEFAULT_SHORTCUTS,
  DEFAULT_PANEL_POSITION,
} from '../../src/shared/store';

function chromeStub(): Record<string, unknown> {
  return {
    runtime: {
      sendMessage: async () => ({ ok: false }),
      onMessage: { addListener() {}, removeListener() {} },
      onConnect: { addListener() {}, removeListener() {} },
      getURL: (p: string) => p,
      id: 'test',
    },
    storage: {
      sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {}, removeListener() {} },
    },
    i18n: { getUILanguage: () => 'es' },
    permissions: { contains: async () => true, getAll: async () => ({ origins: [], permissions: [] }) },
    tabs: { query: async () => [], sendMessage: async () => ({}), create: vi.fn(), onRemoved: { addListener() {} } },
    action: {},
  };
}

async function mount() {
  const mod = await import('../../src/onboarding/Onboarding');
  return render(React.createElement(mod.Onboarding));
}

function resetOnboardingStore(): void {
  const current = useKivaraStore.getState();
  useKivaraStore.setState({
    ...current,
    enabled: true,
    subtitlesVisible: true,
    panelOpen: false,
    isPopupMode: false,
    isDarkMode: true,
    mode: 'learning',
    subtitleStyles: { ...DEFAULT_SUBTITLE_STYLES },
    ankiMapping: { ...DEFAULT_ANKI_MAPPING, fieldSources: {} },
    capture: { ...DEFAULT_CAPTURE },
    cleanup: { ...DEFAULT_CLEANUP },
    translate: { ...DEFAULT_TRANSLATE, tiersEnabled: { ...DEFAULT_TRANSLATE.tiersEnabled }, freeChain: [...DEFAULT_TRANSLATE.freeChain], premiumChain: [...DEFAULT_TRANSLATE.premiumChain] },
    asr: { ...DEFAULT_ASR },
    ai: { ...DEFAULT_AI },
    vip: { ...DEFAULT_VIP },
    tts: { ...DEFAULT_TTS },
    panelPosition: DEFAULT_PANEL_POSITION,
    onboarding: { ...DEFAULT_ONBOARDING },
    telemetry: { ...DEFAULT_TELEMETRY },
    shortcuts: { ...DEFAULT_SHORTCUTS },
    audioCaptureActive: false,
  }, true);
}

function mockAnki(result: { ok: boolean; version?: number; error?: string }): void {
  vi.mocked(sendMessage).mockImplementation(async (name: string) => {
    if (name === 'ANKI_PING') return result;
    if (name === 'ANKI_DECKS') return { decks: ['Deck'], models: ['Basic'] };
    if (name === 'ANKI_FIELDS') return { fields: [] };
    return {};
  });
}

/**
 * Stepper dots expose stable test ids and an aria-current marker from the
 * root. The selector intentionally ignores Tailwind classes so a styling
 * change cannot turn this behavior test into a false failure.
 */
function stepDots(): Element[] {
  return [...document.querySelectorAll('[data-testid^="onboarding-step-"]')];
}

const activeIndex = (): number => Number(document.querySelector('[aria-current="step"]')?.getAttribute('data-step-index'));
const doneIndex = (): number => stepDots().filter((d) => d.getAttribute('data-step-state') === 'done').length;

function footer(back: boolean): HTMLButtonElement {
  return screen.getByTestId(back ? 'onboarding-back' : 'onboarding-next') as HTMLButtonElement;
}

function ankiStatus(): HTMLElement {
  return screen.getByTestId('onboarding-anki-status');
}

describe('Onboarding wizard - behavioral characterization (pre-move)', () => {
  beforeEach(async () => {
    cleanup();
    vi.stubGlobal('chrome', chromeStub());
    vi.mocked(sendMessage).mockReset();
    vi.mocked(sendMessage).mockResolvedValue({});
    await useKivaraStore.persist.clearStorage();
    resetOnboardingStore();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('opens on welcome: 7 dots, step 1 active, none done, Next on, Back off', async () => {
    await mount();
    expect(stepDots().length).toBe(7);
    expect(activeIndex()).toBe(0);
    expect(doneIndex()).toBe(0);
    expect(footer(false).disabled).toBe(false);
    expect(footer(true).disabled).toBe(true);
  });

  it('Next advances the active dot; Back returns it', async () => {
    await mount();
    expect(activeIndex()).toBe(0);
    fireEvent.click(footer(false));
    await waitFor(() => expect(activeIndex()).toBe(1));
    fireEvent.click(footer(true));
    await waitFor(() => expect(activeIndex()).toBe(0));
  });

  it('keeps Next locked while pinging or errored, then unlocks on ok', async () => {
    let resolvePing!: (result: { ok: boolean; error?: string }) => void;
    const pendingPing = new Promise<{ ok: boolean; error?: string }>((resolve) => { resolvePing = resolve; });
    vi.mocked(sendMessage).mockImplementation(async (name: string) => {
      if (name === 'ANKI_PING') return pendingPing;
      if (name === 'ANKI_DECKS') return { decks: ['Deck'], models: ['Basic'] };
      return {};
    });
    await mount();
    fireEvent.click(footer(false)); // welcome -> lang
    await waitFor(() => expect(activeIndex()).toBe(1));
    fireEvent.click(footer(false)); // lang -> anki
    await waitFor(() => expect(activeIndex()).toBe(2));
    await waitFor(() => expect(ankiStatus().getAttribute('data-ping-status')).toBe('pinging'));
    expect(footer(false).disabled).toBe(true);

    resolvePing({ ok: false, error: 'Anki offline' });
    await waitFor(() => expect(ankiStatus().getAttribute('data-ping-status')).toBe('error'));
    expect(footer(false).disabled).toBe(true);

    mockAnki({ ok: true, version: 24 });
    fireEvent.click(screen.getByTestId('onboarding-anki-ping'));
    await waitFor(() => expect(ankiStatus().getAttribute('data-ping-status')).toBe('ok'));
    expect(footer(false).disabled).toBe(false);
  });

  it('keeps Next locked on mapping until both deck and model exist', async () => {
    mockAnki({ ok: true, version: 24 });
    await mount();
    fireEvent.click(footer(false)); // welcome -> lang
    fireEvent.click(footer(false)); // lang -> anki
    await waitFor(() => expect(activeIndex()).toBe(2));
    await waitFor(() => expect(footer(false).disabled).toBe(false));
    fireEvent.click(footer(false)); // anki -> mapping
    await waitFor(() => expect(activeIndex()).toBe(3));
    expect(footer(false).disabled).toBe(true);

    await waitFor(() => expect((screen.getByTestId('onboarding-deck-select') as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByTestId('onboarding-model-select'), { target: { value: 'Basic' } });
    expect(footer(false).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('onboarding-deck-select'), { target: { value: 'Deck' } });
    await waitFor(() => expect(footer(false).disabled).toBe(false));

    fireEvent.change(screen.getByTestId('onboarding-deck-select'), { target: { value: '' } });
    expect(footer(false).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('onboarding-deck-select'), { target: { value: 'Deck' } });
    await waitFor(() => expect(footer(false).disabled).toBe(false));
  });
});
