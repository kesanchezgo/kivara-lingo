/**
 * One classifier, two entry points.
 *
 * The service worker classifies with the transport code; the panel sees only
 * the sentence a row stored before codes existed. Both must land in the SAME
 * family for every real AnkiConnect failure — otherwise the same outage reads
 * as "Anki is down" in the worker and "AnkiConnect rejected the note" in the
 * panel, which is what the net was supposed to end.
 *
 * The seven sentences below are the real ones `anki-connect.ts` throws, in
 * both dictionaries (`src/shared/i18n/sw.ts`), plus the model/deck refusal the
 * provider itself returns.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ALL_MESSAGES } from '../../src/shared/i18n';
import { classifyCardError } from '../../src/shared/card-errors';
import type { AnkiPingErrorCode, CreateCardErrorCode } from '../../src/shared/types';

const LOCALES = ['es', 'en'] as const;

function message(
  locale: (typeof LOCALES)[number],
  key: string,
  vars: Record<string, string | number> = {},
): string {
  let out = ALL_MESSAGES[locale][key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

interface Case {
  name: string;
  text: (locale: (typeof LOCALES)[number]) => string;
  code: AnkiPingErrorCode;
  family: CreateCardErrorCode;
}

const CASES: Case[] = [
  {
    name: 'timeout',
    text: (locale) => message(locale, 'anki.timeout', { ms: 4000 }),
    code: 'TIMEOUT',
    family: 'timeout',
  },
  {
    name: 'HTTP 500',
    text: (locale) => message(locale, 'anki.http', { status: 500 }),
    code: 'HTTP',
    family: 'anki-error',
  },
  {
    name: 'unreadable response',
    text: (locale) =>
      message(locale, 'anki.unreadable', {
        reason: "SyntaxError: Unexpected token '<'",
        url: 'http://127.0.0.1:8765',
      }),
    code: 'HTTP',
    family: 'anki-error',
  },
  {
    name: 'model/deck not found',
    // AnkiConnect's own refusal, not a dictionary sentence: Anki speaks it.
    text: () => 'model "Basic" was not found',
    code: 'ANKI',
    family: 'anki-error',
  },
  {
    name: 'API key',
    text: (locale) => message(locale, 'anki.apiKeyRequired'),
    code: 'API_KEY',
    family: 'api-key',
  },
  {
    name: 'NETWORK',
    text: (locale) => message(locale, 'anki.network', { reason: 'Failed to fetch' }),
    code: 'NETWORK',
    family: 'anki-down',
  },
  {
    name: 'loopback refusal',
    text: (locale) => message(locale, 'anki.loopbackRefused'),
    code: 'LOOPBACK_REFUSED',
    family: 'anki-down',
  },
];

afterEach(() => {
  cleanup();
});

describe('raw text and transport code agree on every real failure', () => {
  for (const locale of LOCALES) {
    for (const testCase of CASES) {
      it(`${testCase.name} (${locale})`, () => {
        const text = testCase.text(locale);
        // The worker's verdict.
        expect(classifyCardError(text, testCase.code)).toBe(testCase.family);
        // The legacy row has only the sentence, and must read the same.
        expect(classifyCardError(text)).toBe(testCase.family);
      });
    }
  }

  it('a "could not reach" sentence is a network failure', () => {
    expect(classifyCardError('Could not reach the Anki server.')).toBe('anki-down');
  });

  it('an explicit AnkiConnect refusal stays an Anki error', () => {
    expect(classifyCardError('AnkiConnect error: model "X" was not found')).toBe('anki-error');
  });
});
