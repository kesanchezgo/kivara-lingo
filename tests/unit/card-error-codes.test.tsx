/**
 * Card failures carry a CODE the panel translates (debt D1).
 *
 * Before this, the panel re-guessed the reason from a provider sentence
 * (`shortError` regexes), so the same failure read differently depending on
 * which string the worker happened to produce — and a new failure family meant
 * teaching the regex. The worker now classifies once; the row renders the
 * dictionary entry for that code, and `shortError` survives only as the
 * fallback for rows written before codes existed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ALL_MESSAGES, t } from '../../src/shared/i18n';
import { CARD_ERROR_LABEL_KEYS, classifyCardError } from '../../src/shared/card-errors';
import { markFailed, markQueued, newRecentCard, type RecentCard } from '../../src/shared/cards';
import { RecentCards } from '../../src/app/components/tabs/RecentCards';
import type { CreateCardErrorCode } from '../../src/shared/types';

const ALL_CODES: CreateCardErrorCode[] = [
  'no-deck', 'no-model', 'disabled', 'no-token',
  'api-key', 'timeout', 'anki-down', 'anki-error', 'unknown',
];

afterEach(() => {
  cleanup();
});

describe('CARD_ERROR_LABEL_KEYS', () => {
  it('names a label that exists in es and en for every code', () => {
    for (const code of ALL_CODES) {
      const key = CARD_ERROR_LABEL_KEYS[code];
      expect(key, code).toBeTruthy();
      expect(ALL_MESSAGES.es[key], `${code} es`).toBeTruthy();
      expect(ALL_MESSAGES.en[key], `${code} en`).toBeTruthy();
      expect(ALL_MESSAGES.es[key]).not.toBe(key);
    }
  });

  it('has a key for exactly the declared codes', () => {
    expect(Object.keys(CARD_ERROR_LABEL_KEYS).sort()).toEqual([...ALL_CODES].sort());
  });
});

describe('classifyCardError', () => {
  it('reads the families a provider sentence can name', () => {
    expect(classifyCardError('HTTP 401 Unauthorized')).toBe('api-key');
    expect(classifyCardError('AnkiConnect error: forbidden')).toBe('api-key');
    expect(classifyCardError('The request took too long (timeout)')).toBe('timeout');
    expect(classifyCardError('TypeError: Failed to fetch')).toBe('anki-down');
    expect(classifyCardError('connect ECONNREFUSED 127.0.0.1:8765')).toBe('anki-down');
    expect(classifyCardError('addNote failed: duplicate')).toBe('anki-error');
    expect(classifyCardError('')).toBe('unknown');
    expect(classifyCardError(undefined)).toBe('unknown');
  });

  it('prefers the ping code, which is more precise than the text', () => {
    expect(classifyCardError('whatever', 'API_KEY')).toBe('api-key');
    expect(classifyCardError('whatever', 'TIMEOUT')).toBe('timeout');
    expect(classifyCardError('whatever', 'LOOPBACK_REFUSED')).toBe('anki-down');
    expect(classifyCardError('whatever', 'ANKI')).toBe('anki-error');
  });
});

describe('the registry row keeps the code', () => {
  const base = newRecentCard({
    id: 'c1', word: 'sane', sentence: 'It is sane.', kind: 'word',
    deck: 'English', lang: 'en', tags: [],
  });

  it('markFailed stores the code it was given', () => {
    const row = markFailed(base, 'nope', 'api-key');
    expect(row.status).toBe('failed');
    expect(row.errorCode).toBe('api-key');
  });

  it('markQueued stores the code it was given', () => {
    const row = markQueued(base, 'refused', 1_000, 'anki-down');
    expect(row.status).toBe('queued');
    expect(row.errorCode).toBe('anki-down');
  });

  it('leaves the code absent when the caller had none (legacy writers)', () => {
    expect(markFailed(base, 'nope').errorCode).toBeUndefined();
  });
});

describe('the row renders the code, not the raw sentence', () => {
  /**
   * `RecentCards` reads the registry through `chrome.storage.local.get` in its
   * CALLBACK form; the shared mock answers promises only, so the row would
   * never mount. This stub answers both shapes from one array.
   */
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

  function row(overrides: Partial<RecentCard>): RecentCard {
    return {
      ...newRecentCard({
        id: 'c2', word: 'sane', sentence: 'It is sane.', kind: 'word',
        deck: 'English', lang: 'en', tags: [],
      }),
      ...overrides,
    };
  }

  it('shows the dictionary label for a coded failure even when the raw text disagrees', () => {
    seedRegistry([row({
      status: 'failed',
      // The raw text WOULD classify as "down"; the code says API key, and the
      // code is the worker's verdict, not a guess.
      error: 'TypeError: Failed to fetch',
      errorCode: 'api-key',
    })]);
    render(React.createElement(RecentCards));
    // The meta line reads «Sin enviar · <label>», so the match is by substring.
    expect(screen.getByText(new RegExp(t('recent.code.apiKey')))).toBeTruthy();
    expect(screen.queryByText(new RegExp(t('recent.err.down')))).toBeNull();
  });

  it('falls back to classifying the raw text on a legacy row without a code', () => {
    seedRegistry([row({ status: 'failed', error: 'HTTP 401 Unauthorized' })]);
    render(React.createElement(RecentCards));
    expect(screen.getByText(new RegExp(t('recent.err.apiKey')))).toBeTruthy();
  });
});
