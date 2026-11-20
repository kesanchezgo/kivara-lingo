/**
 * RED TEST — audit round 7, P4: a retried card that REUSED an existing note
 * says "Ya estaba en tu mazo" — the "sent" and failure toasts never appear.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { sendMessage } from 'webext-bridge/content-script';
import { t } from '../../src/shared/i18n';
import { markQueued, newRecentCard, type RecentCard } from '../../src/shared/cards';
import { RecentCards } from '../../src/app/components/tabs/RecentCards';

vi.mock('sonner', () => {
  const toast = vi.fn();
  Object.assign(toast, {
    custom: vi.fn(), error: vi.fn(), success: vi.fn(),
    message: vi.fn(), dismiss: vi.fn(), loading: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

function seedRegistry(rows: RecentCard[]): void {
  const storage = (globalThis as unknown as {
    chrome: { storage: { local: Record<string, unknown> } };
  }).chrome.storage.local;
  storage.get = ((key: string, cb?: (v: Record<string, unknown>) => void) => {
    const out = { [key]: rows };
    if (typeof cb === 'function') {
      cb(out);
      return undefined;
    }
    return Promise.resolve(out);
  }) as never;
}

function row(): RecentCard {
  return markQueued(newRecentCard({
    id: 'card-q', word: 'run', sentence: 'She runs it.',
    kind: 'word', deck: 'English vocab', lang: 'en',
    tags: ['kivara-lingo'],
  }), 'boom', 1);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('retry toast on a REUSED note', () => {
  it('says "Ya estaba en tu mazo" — never "sent" and never the failure line', async () => {
    const chromeStub = (globalThis as unknown as { chrome: unknown }).chrome as {
      storage: { local: Record<string, unknown> };
    };
    seedRegistry([row()]);
    vi.mocked(sendMessage).mockImplementation(async (channel: string) => {
      if (channel === 'CARD_RETRY') return { ok: true, noteId: 4242, reused: 'other-context' };
      return { ok: true };
    });
    render(<RecentCards />);
    const retry = await screen.findByRole('button', { name: t('recent.retry') });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(t('queue.alreadyInDeck'));
    });
    expect(toast.success).not.toHaveBeenCalledWith(t('queue.autoSentOne'));
    expect(toast.error).not.toHaveBeenCalled();
    void chromeStub;
  });

  it('a normal (created) retry still says "sent"', async () => {
    seedRegistry([row()]);
    vi.mocked(sendMessage).mockImplementation(async (channel: string) => {
      if (channel === 'CARD_RETRY') return { ok: true, noteId: 900 };
      return { ok: true };
    });
    render(<RecentCards />);
    const retry = await screen.findByRole('button', { name: t('recent.retry') });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(t('queue.autoSentOne'));
    });
    expect(toast.success).not.toHaveBeenCalledWith(t('queue.alreadyInDeck'), expect.anything());
  });
});
