/**
 * The accordion state of Settings under a deep link, in the prop shape the deep
 * link actually uses: `initialSection` carries a section that can only be natively
 * supplied once, and `initialNonce` alone carries "a request happened", which is
 * the whole reason it exists. The last requirement says a section must stay as it
 * was when nothing new is delivered.
 *
 * Everything outside the accordion state is stubbed; what is asserted is the
 * real Accordion DOM, through the `aria-expanded` it now exposes (the hidden
 * margin of the section id to its header button).
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/shared/store', () => {
  const state = {
    capture: { autoMode: false, audioSource: 'mic', bufferSize: 300 },
    cleanup: { hideUI: false, hideShadows: false },
    mode: 'learning',
    translate: { provider: 'google', mode: 'single', tiersEnabled: { free: true, premium: false } },
    asr: { enabled: false, model: 'small' },
    ai: { provider: 'disabled', apiKey: '', model: 'gpt-4o-mini' },
    tts: { provider: 'disabled' },
    vip: { enabled: false },
    panelPosition: { top: 0, left: 0 },
    subtitleStyles: {},
    ankiMapping: {},
    isDarkMode: false,
    setIsDarkMode: () => {},
  };
  // Plain state when called with no argument (the common read), and a field
  // reader when given one, because the component uses both shapes.
  const useKivaraStore = ((selector?: (s: unknown) => unknown) =>
    selector ? selector(state) : state) as unknown as () => typeof state;
  useKivaraStore.setState = () => {};
  useKivaraStore.subscribe = () => () => {};
  useKivaraStore.getState = () => state;
  return { useKivaraStore };
});
vi.mock('../../src/app/hooks/useShortcuts', () => ({ useShortcuts: () => ({ map: {} }) }));
vi.mock('../../src/app/components/tabs/DictPacksSection', () => ({
  DictPacksSection: () => null,
}));
vi.mock('../../src/app/components/SyncWriteErrorBanner', () => ({
  SyncWriteErrorBanner: () => null,
}));
vi.mock('../../src/app/components/HostPermissionsRow', () => ({
  HostPermissionsRow: () => null,
}));
vi.mock('../../src/app/components/tabs/VipSection', () => ({ VipSection: () => null }));
vi.mock('../../src/app/components/AiByokSection', () => ({ AiByokSection: () => null }));
vi.mock('../../src/app/components/tabs/ShortcutEditor', () => ({
  ShortcutEditor: () => null,
}));

/** `aria-expanded` of an accordion, located by text in its own header: each
 *  section's button carries a unique uppercase title. */
function expandedByTitle(titleFragment: string): boolean {
  const header = Array.from(document.querySelectorAll('button[aria-expanded]')).find((b) =>
    b.textContent?.toUpperCase().includes(titleFragment.toUpperCase()),
  );
  return header?.getAttribute('aria-expanded') === 'true';
}

const permOpen = () => expandedByTitle('Acceso a sitios');
const ttsOpen = () => expandedByTitle('TTS premium');

describe('Settings accordions under a deep link', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: () => {}, lastError: null },
      storage: {
        session: { get: async () => ({}), remove: async () => {} },
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
      i18n: { getUILanguage: () => 'es' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.textContent = '';
  });

  it('expands the section it is opened with', async () => {
    const { SettingsTab } = await import('../../src/app/components/tabs/SettingsTab');
    await act(async () => {
      render(<SettingsTab initialSection="perm" initialNonce={1} />);
    });
    expect(permOpen()).toBe(true);
  });

  it('a DIFFERENT section replaces the old one while the tab stays mounted', async () => {
    const { SettingsTab } = await import('../../src/app/components/tabs/SettingsTab');
    const tree = render(<SettingsTab initialSection="perm" initialNonce={1} />);
    expect(permOpen()).toBe(true);

    // The regression this pins: without the `setDeepLinkSection` in the nonce
    // effect, the requested section never changed and tts stayed closed.
    // Expanding adds a key — the panel's existing behaviour for manual toggles
    // too — so perm does not close; what must change is the one asked for.
    await act(async () => {
      tree.rerender(<SettingsTab initialSection="tts" initialNonce={2} />);
    });
    expect(ttsOpen()).toBe(true);
  });

  it('the SAME section repeated stays open (a repeat is not a collapse)', async () => {
    const { SettingsTab } = await import('../../src/app/components/tabs/SettingsTab');
    const tree = render(<SettingsTab initialSection="perm" initialNonce={1} />);
    expect(permOpen()).toBe(true);

    await act(async () => {
      tree.rerender(<SettingsTab initialSection="perm" initialNonce={2} />);
    });
    expect(permOpen()).toBe(true);
  });

  it('an unchanged nonce is not an event (the accordion stays as the user left it)', async () => {
    const { SettingsTab } = await import('../../src/app/components/tabs/SettingsTab');
    const tree = render(<SettingsTab initialSection="perm" initialNonce={1} />);
    expect(permOpen()).toBe(true);
    const header = screen.getByRole('button', { expanded: true });
    await act(async () => header.click());
    expect(permOpen()).toBe(false);

    // The very same props again: nothing is delivered, so nothing reopens.
    await act(async () => {
      tree.rerender(<SettingsTab initialSection="perm" initialNonce={1} />);
    });
    expect(permOpen()).toBe(false);
  });
});
