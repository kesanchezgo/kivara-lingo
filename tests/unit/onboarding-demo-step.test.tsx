/**
 * DemoStep's allow-all card — the prototype's "Permitir todo" action over the
 * repo's real permission helpers.
 *
 * One click must ask for EVERY missing origin in a single `requestHosts` call
 * (one Chrome dialog), and the card must collapse to the done state once the
 * groups are covered. The per-group rows below stay a separate control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  requestHosts: vi.fn(),
  getGrantedOrigins: vi.fn(),
  hasOrigin: vi.fn(),
}));

vi.mock('../../src/shared/host-permissions', () => ({
  requestHosts: h.requestHosts,
  revokeHosts: vi.fn(),
  permissionsApiAvailable: () => true,
}));

vi.mock('../../src/shared/host-permissions-store', () => ({
  subscribeHostPermissions: () => () => {},
  getGrantedOrigins: h.getGrantedOrigins,
  refreshHostPermissions: vi.fn(),
  hasOrigin: h.hasOrigin,
}));

import { HostAccessCard } from '../../src/onboarding/steps/DemoStep';

describe('DemoStep allow-all', () => {
  beforeEach(() => {
    h.requestHosts.mockReset().mockResolvedValue([]);
    h.getGrantedOrigins.mockReset().mockReturnValue([]);
    h.hasOrigin.mockReset().mockReturnValue(false);
  });
  afterEach(() => cleanup());

  it('asks for every missing origin in one request', async () => {
    render(<HostAccessCard />);
    const button = screen.getByTestId('onb-host-allow-all');
    expect(button.textContent).toContain('Permitir todo');

    fireEvent.click(button);

    await waitFor(() => expect(h.requestHosts).toHaveBeenCalledTimes(1));
    const origins = h.requestHosts.mock.calls[0]![0] as string[];
    expect(origins).toContain('https://api.openai.com/*');
    expect(origins).toContain('https://api.deepl.com/*');
    expect(origins).toContain('https://api.elevenlabs.io/*');
    expect(origins.length).toBeGreaterThan(20);
  });

  it('collapses to the done state once every group is granted', () => {
    h.hasOrigin.mockReturnValue(true);
    render(<HostAccessCard />);
    expect(screen.queryByTestId('onb-host-allow-all')).toBeNull();
    expect(screen.getByText('Listo: todas las fuentes online tienen acceso.')).toBeTruthy();
  });
});