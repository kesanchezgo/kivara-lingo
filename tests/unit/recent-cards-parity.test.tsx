/**
 * Recent cards parity: the prototype's list view over the repo's registry.
 *
 * The service worker publishes `kvl:cards.recent`; these cases read a
 * hand-built registry through a callback-style `chrome.storage.local` stub and
 * pin the ported behaviours: the All/Queued filters, the page of five with
 * "show all", the missing-media note, the context count and the short error
 * rows classified from the engine's error message.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecentCards, RECENT_CARDS_KEY } from '../../src/app/components/tabs/RecentCards';
import type { RecentCard } from '../../src/shared/cards';

function card(overrides: Partial<RecentCard> = {}): RecentCard {
  return {
    id: 'card-1',
    word: 'sane',
    sentence: 'That is sane.',
    status: 'saved',
    kind: 'word',
    deck: 'Default',
    lang: 'en',
    createdAt: Date.now(),
    attempts: 0,
    tags: [],
    ...overrides,
  };
}

function installRegistry(cards: RecentCard[]) {
  const chromeMock = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  chromeMock.storage = {
    ...(chromeMock.storage as Record<string, unknown>),
    local: {
      get: vi.fn((_keys: string, callback: (res: Record<string, unknown>) => void) => {
        callback({ [RECENT_CARDS_KEY]: cards });
      }),
      set: vi.fn(),
      remove: vi.fn(),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  };
}

beforeEach(() => { cleanup(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('RecentCards · filters', () => {
  it('filters to the retry queue and back', () => {
    installRegistry([
      card({ id: 'queued-1', word: 'retryword', status: 'queued', attempts: 2, nextRetryAt: Date.now() + 30_000 }),
      card({ id: 'saved-1', word: 'savedword', status: 'saved', savedAt: Date.now() }),
    ]);
    render(<RecentCards />);

    const queueFilter = screen.getByRole('radio', { name: /En cola/ });
    expect(queueFilter).toBeTruthy();
    expect(screen.getByText('savedword')).toBeTruthy();

    fireEvent.click(queueFilter);
    expect(screen.queryByText('savedword')).toBeNull();
    expect(screen.getByText('retryword')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Todas/ }));
    expect(screen.getByText('savedword')).toBeTruthy();
  });
});

describe('RecentCards · error rows', () => {
  it('classifies a network failure as Anki not responding', () => {
    installRegistry([card({ id: 'failed-1', status: 'failed', attempts: 3, error: 'fetch failed' })]);
    render(<RecentCards />);
    expect(screen.getByText(/Sin enviar · Anki no responde/)).toBeTruthy();
  });

  it('classifies a timeout and a rejected API key', () => {
    installRegistry([
      card({ id: 'failed-timeout', word: 'slowword', status: 'failed', attempts: 3, error: 'Timed out waiting for Anki' }),
      card({ id: 'failed-key', word: 'keyword', status: 'failed', attempts: 1, error: 'API key rejected (401)' }),
    ]);
    render(<RecentCards />);
    expect(screen.getByText(/Sin enviar · Anki tardó demasiado/)).toBeTruthy();
    expect(screen.getByText(/Sin enviar · Clave de API incorrecta/)).toBeTruthy();
  });
});

describe('RecentCards · paging and media notes', () => {
  it('shows five cards and expands to show all', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card({
      id: `saved-${i}`,
      word: `word${i}`,
      status: 'saved',
      savedAt: Date.now(),
    }));
    installRegistry(cards);
    const { container } = render(<RecentCards />);

    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(screen.getByText('Ver todas (6)')).toBeTruthy();

    fireEvent.click(screen.getByText('Ver todas (6)'));
    expect(container.querySelectorAll('li')).toHaveLength(6);
    expect(screen.getByText('Ver menos')).toBeTruthy();
  });

  it('names what a saved card is missing and how many contexts it has', () => {
    const withContexts = card({
      id: 'saved-media',
      word: 'contextword',
      status: 'saved',
      savedAt: Date.now(),
      media: { frame: false, audio: false, word: false },
    }) as RecentCard & { contexts: number };
    withContexts.contexts = 2;
    installRegistry([withContexts]);
    render(<RecentCards />);

    expect(screen.getByText('+2 contextos', { exact: false })).toBeTruthy();
    expect(screen.getByText('sin captura ni audio', { exact: false })).toBeTruthy();
  });
});
