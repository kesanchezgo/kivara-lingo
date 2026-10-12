/**
 * Rendered SettingsTab characterization for the settings split.
 *
 * The cases pin the controls that carry side effects: VIP visibility, cache TTL
 * commit semantics, provider host permission requests, and host grant/revoke.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useKivaraStore } from '../../src/shared/store';
import { DEFAULT_VIP, DEFAULT_TRANSLATE, DEFAULT_TTS, DEFAULT_AI, DEFAULT_CAPTURE, DEFAULT_CLEANUP, DEFAULT_ONBOARDING, DEFAULT_TELEMETRY, DEFAULT_SHORTCUTS, DEFAULT_PANEL_POSITION, DEFAULT_SUBTITLE_STYLES, DEFAULT_ANKI_MAPPING } from '../../src/shared/store';
import type { VipSettings } from '../../src/shared/types';
import { refreshHostPermissions } from '../../src/shared/host-permissions-store';
import { PROVIDER_HOSTS, hostsForProviders } from '../../src/shared/provider-hosts';

vi.mock('webext-bridge/content-script', () => ({ sendMessage: vi.fn().mockResolvedValue({ ok: false }) }));
vi.mock('../../src/app/hooks/useShortcuts', () => ({ useShortcuts: () => ({ map: {} }) }));
vi.mock('../../src/app/components/tabs/DictPacksSection', () => ({ DictPacksSection: () => null }));
vi.mock('../../src/app/components/SyncWriteErrorBanner', () => ({ SyncWriteErrorBanner: () => null }));
vi.mock('../../src/app/components/ShortcutEditor', () => ({ ShortcutEditor: () => null }));

/** The dictionary group owns exactly these providers, so the grant test can
 *  compare origins without copying the list HostPermissionsRow carries. */
const dictProviders = Object.keys(PROVIDER_HOSTS).filter((id) => id.startsWith('dict:'));
const dictOrigins = hostsForProviders(dictProviders);

const chromeStub = () => ({
  runtime: { sendMessage: vi.fn(), getURL: (path: string) => path, lastError: null, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  permissions: {
    getAll: vi.fn(async () => ({ origins: [] as string[] })),
    contains: vi.fn(() => Promise.resolve(false)),
    request: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
  },
  storage: { session: { get: vi.fn().mockResolvedValue({}), remove: vi.fn().mockResolvedValue(undefined) }, local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } },
  i18n: { getUILanguage: () => 'es' },
});

function resetStore() {
  const state = useKivaraStore.getState();
  useKivaraStore.setState({
    ...state,
    vip: { ...DEFAULT_VIP },
    translate: { ...DEFAULT_TRANSLATE, tiersEnabled: { ...DEFAULT_TRANSLATE.tiersEnabled }, freeChain: [...DEFAULT_TRANSLATE.freeChain], premiumChain: [...DEFAULT_TRANSLATE.premiumChain] },
    tts: { ...DEFAULT_TTS }, ai: { ...DEFAULT_AI }, capture: { ...DEFAULT_CAPTURE }, cleanup: { ...DEFAULT_CLEANUP }, onboarding: { ...DEFAULT_ONBOARDING }, telemetry: { ...DEFAULT_TELEMETRY }, shortcuts: { ...DEFAULT_SHORTCUTS }, panelPosition: DEFAULT_PANEL_POSITION, subtitleStyles: { ...DEFAULT_SUBTITLE_STYLES }, ankiMapping: { ...DEFAULT_ANKI_MAPPING, fieldSources: {} },
  }, true);
}

async function mountSettings() {
  const { SettingsTab } = await import('../../src/app/components/tabs/SettingsTab');
  return render(<SettingsTab />);
}

beforeEach(async () => {
  cleanup();
  vi.stubGlobal('chrome', chromeStub());
  // The permissions store is a module singleton: its `granted` cache outlives a
  // test, so a group granted here would render as "Concedido" in the next one
  // under a shuffled order. Re-reading an empty grant resets the picture.
  await act(async () => refreshHostPermissions());
  await useKivaraStore.persist.clearStorage();
  resetStore();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SettingsTab behavior across the split', () => {
  it('hides premium VIP source controls until VIP is enabled', async () => {
    await mountSettings();
    fireEvent.click(screen.getByRole('button', { name: /Enriquecimiento/i }));
    expect(screen.queryByText('Cambridge')).toBeNull();
    await act(async () => useKivaraStore.getState().setVip((prev: VipSettings) => ({ ...prev, enabled: true })));
    await waitFor(() => expect(screen.getByText('Cambridge')).not.toBeNull());
  });

  it('writes the VIP TTL only on commitment, not while typing', async () => {
    const store = useKivaraStore.getState();
    const writes = vi.spyOn(store, 'setVip');
    await mountSettings();
    // Updater form: `setVip` replaces the whole object when handed a value,
    // which would drop the rest of the section (the bug this test guards).
    await act(async () => store.setVip((prev) => ({ ...prev, enabled: true })));
    writes.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Enriquecimiento/i }));
    const input = screen.getByRole('spinbutton', { name: /caché/i });

    // Each keystroke stays local: a field that committed on change would
    // already have written, and the store would hold a half-typed value.
    for (const partial of ['9', '99', '999']) {
      fireEvent.change(input, { target: { value: partial } });
      expect(writes).not.toHaveBeenCalled();
      expect(useKivaraStore.getState().vip.cacheTtlDays).toBe(DEFAULT_VIP.cacheTtlDays);
    }

    fireEvent.blur(input);
    await waitFor(() => expect(useKivaraStore.getState().vip.cacheTtlDays).toBe(365));
    expect(writes).toHaveBeenCalledTimes(1);

    // A cleared field is an unfinished input, not "the minimum": it falls
    // back to the default instead of parking a 1-day cache.
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(useKivaraStore.getState().vip.cacheTtlDays).toBe(DEFAULT_VIP.cacheTtlDays));
    // The second fallback is a no-op write, not a second commit: the field
    // already holds the committed value, which is the guard that also keeps
    // Enter+blur from writing twice.
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    await waitFor(() => expect(useKivaraStore.getState().vip.cacheTtlDays).toBe(DEFAULT_VIP.cacheTtlDays));
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('requests provider hosts from the provider control gesture', async () => {
    const request = vi.mocked(chrome.permissions.request);
    await mountSettings();
    fireEvent.click(screen.getByRole('button', { name: /TTS premium/i }));
    const selects = screen.getAllByRole('combobox');
    const select = selects.find((node) => (node as HTMLSelectElement).value === 'auto') as HTMLSelectElement;
    expect(select).toBeDefined();
    fireEvent.change(select, { target: { value: 'elevenlabs' } });
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls[0][0].origins).toEqual(expect.arrayContaining(['https://api.elevenlabs.io/*']));
  });

  it('grants and revokes the dictionary group through the mounted tab', async () => {
    const request = vi.mocked(chrome.permissions.request);
    const remove = vi.mocked(chrome.permissions.remove);
    const getAll = vi.mocked(chrome.permissions.getAll);
    await mountSettings();
    fireEvent.click(screen.getByRole('button', { name: /Acceso a sitios/i }));
    await screen.findAllByRole('button', { name: 'Conceder' });

    /** The row is the first ancestor that carries the group label, so the
     *  assertions stay about this group's buttons and not another's. */
    const dictRow = (): HTMLElement => {
      const label = screen.getByText('Diccionarios y tesauros');
      for (let node: HTMLElement | null = label.parentElement; node; node = node.parentElement) {
        if (node === document.body) break;
        if ([...node.querySelectorAll('button')].some((b) => /Conced|Revoc/.test(b.textContent ?? ''))) {
          return node;
        }
      }
      throw new Error('dictionary permission row not found');
    };
    const row = dictRow();

    const grant = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Conceder');
    expect(grant).toBeDefined();
    fireEvent.click(grant!);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    // Exact origins: the whole dictionary group, and nothing beyond it.
    expect([...new Set(request.mock.calls[0][0].origins)].sort()).toEqual([...new Set(dictOrigins)].sort());

    // The grant answer comes back from chrome, not from our own state.
    getAll.mockResolvedValue({ origins: [...dictOrigins] } as unknown as void);
    await act(async () => refreshHostPermissions());
    const revoke = [...dictRow().querySelectorAll('button')].find((b) => b.textContent === 'Revocar');
    expect(revoke).toBeDefined();
    fireEvent.click(revoke!);
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect([...new Set(remove.mock.calls[0][0].origins)].sort()).toEqual([...new Set(dictOrigins)].sort());
  });
});
