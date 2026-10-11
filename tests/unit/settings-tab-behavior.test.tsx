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
import { DEFAULT_VIP, DEFAULT_TRANSLATE, DEFAULT_TTS, DEFAULT_AI, DEFAULT_CAPTURE, DEFAULT_CLEANUP, DEFAULT_ASR, DEFAULT_ONBOARDING, DEFAULT_TELEMETRY, DEFAULT_SHORTCUTS, DEFAULT_PANEL_POSITION, DEFAULT_SUBTITLE_STYLES, DEFAULT_ANKI_MAPPING } from '../../src/shared/store';
import { refreshHostPermissions } from '../../src/shared/host-permissions-store';

vi.mock('webext-bridge/content-script', () => ({ sendMessage: vi.fn().mockResolvedValue({ ok: false }) }));
vi.mock('../../src/app/hooks/useShortcuts', () => ({ useShortcuts: () => ({ map: {} }) }));
vi.mock('../../src/app/components/tabs/DictPacksSection', () => ({ DictPacksSection: () => null }));
vi.mock('../../src/app/components/SyncWriteErrorBanner', () => ({ SyncWriteErrorBanner: () => null }));
vi.mock('../../src/app/components/ShortcutEditor', () => ({ ShortcutEditor: () => null }));

const chromeStub = () => ({
  runtime: { sendMessage: vi.fn(), getURL: (path: string) => path, lastError: null, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  permissions: {
    getAll: vi.fn().mockResolvedValue({ origins: [] }),
    contains: vi.fn().mockResolvedValue(false),
    request: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
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
    tts: { ...DEFAULT_TTS }, ai: { ...DEFAULT_AI }, capture: { ...DEFAULT_CAPTURE }, cleanup: { ...DEFAULT_CLEANUP }, asr: { ...DEFAULT_ASR }, onboarding: { ...DEFAULT_ONBOARDING }, telemetry: { ...DEFAULT_TELEMETRY }, shortcuts: { ...DEFAULT_SHORTCUTS }, panelPosition: DEFAULT_PANEL_POSITION, subtitleStyles: { ...DEFAULT_SUBTITLE_STYLES }, ankiMapping: { ...DEFAULT_ANKI_MAPPING, fieldSources: {} },
  }, true);
}

async function mountSettings() {
  const { SettingsTab } = await import('../../src/app/components/tabs/SettingsTab');
  return render(<SettingsTab />);
}

beforeEach(async () => {
  cleanup();
  vi.stubGlobal('chrome', chromeStub());
  await useKivaraStore.persist.clearStorage();
  resetStore();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SettingsTab behavior across the split', () => {
  it('hides premium VIP source controls until VIP is enabled', async () => {
    await mountSettings();
    fireEvent.click(screen.getByRole('button', { name: /Enriquecimiento/i }));
    expect(screen.queryByText('Cambridge')).toBeNull();
    useKivaraStore.getState().setVip({ enabled: true });
    await waitFor(() => expect(screen.getByText('Cambridge')).not.toBeNull());
  });

  it('commits VIP TTL once on blur and clamps invalid values', async () => {
    await mountSettings();
    useKivaraStore.getState().setVip({ enabled: true });
    fireEvent.click(screen.getByRole('button', { name: /Enriquecimiento/i }));
    const input = screen.getByRole('spinbutton', { name: /caché/i });
    const writes = vi.spyOn(useKivaraStore.getState(), 'setVip');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    await waitFor(() => expect(useKivaraStore.getState().vip.cacheTtlDays).toBe(365));
    expect(writes).toHaveBeenCalledTimes(1);
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

  it('renders host permission groups and calls grant/revoke', async () => {
    const { HostPermissionsRow } = await import('../../src/app/components/HostPermissionsRow');
    render(<HostPermissionsRow />);
    const grant = screen.getAllByRole('button', { name: 'Conceder' })[0];
    fireEvent.click(grant);
    await waitFor(() => expect(chrome.permissions.request).toHaveBeenCalled());
    const origins = await import('../../src/shared/provider-hosts');
    vi.mocked(chrome.permissions.getAll).mockResolvedValue({ origins: origins.providerHosts('dict:wiktionary') });
    await act(async () => refreshHostPermissions());
    const revoke = screen.getAllByRole('button', { name: 'Revocar' })[0];
    fireEvent.click(revoke);
    await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalled());
  });
});
