/**
 * The sentences `anki-connect.ts` actually throws classify as the right family.
 *
 * The previous regexes read `connect` inside "AnkiConnect", so every provider
 * sentence — a model Anki could not find, an HTTP 500 — was reported as "Anki
 * isn't responding", and the Spanish timeout sentence (which never says
 * "timeout") read as a network failure too. These assertions use the REAL
 * strings from the client, in both dictionaries, plus the transport code the
 * orchestrator now passes through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ALL_MESSAGES, t } from '../../src/shared/i18n';
import { CARD_ERROR_LABEL_KEYS, classifyCardError } from '../../src/shared/card-errors';
import { showCardSaveError } from '../../src/content/ui/save-actions';
import type { AnkiPingErrorCode } from '../../src/shared/types';

vi.mock('sonner', () => {
  const toast = vi.fn();
  Object.assign(toast, {
    custom: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

const LOCALES = ['es', 'en'] as const;

/** One dictionary sentence with its placeholders filled, in a chosen locale. */
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

const TIMEOUT = { ms: 4000 };
const HTTP = { status: 500 };
const UNREADABLE = {
  reason: "SyntaxError: Unexpected token '<'",
  url: 'http://127.0.0.1:8765',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('the real AnkiConnect sentences classify', () => {
  for (const locale of LOCALES) {
    it(`reads the timeout sentence as timeout (${locale})`, () => {
      const sentence = message(locale, 'anki.timeout', TIMEOUT);
      expect(sentence).toContain('4000');
      expect(classifyCardError(sentence)).toBe('timeout');
    });

    it(`reads the HTTP status sentence as anki-error (${locale})`, () => {
      expect(classifyCardError(message(locale, 'anki.http', HTTP))).toBe('anki-error');
    });

    it(`reads the unreadable-response sentence as anki-error (${locale})`, () => {
      expect(classifyCardError(message(locale, 'anki.unreadable', UNREADABLE))).toBe('anki-error');
    });

    it(`reads the missing-API-key sentence as api-key (${locale})`, () => {
      expect(classifyCardError(message(locale, 'anki.apiKeyRequired'))).toBe('api-key');
    });
  }

  it('classifies through the dictionary `t()` the worker calls', () => {
    // LOCALE is pinned to 'es' by tests/setup.ts: the live call and the fixture
    // must be the same sentence, not two copies that can drift.
    expect(message('es', 'anki.timeout', TIMEOUT)).toBe(t('anki.timeout', TIMEOUT));
    expect(message('es', 'anki.http', HTTP)).toBe(t('anki.http', HTTP));
    expect(message('es', 'anki.network', { reason: 'Failed to fetch' })).toBe(
      t('anki.network', { reason: 'Failed to fetch' }),
    );
  });

  it('reads an Anki refusal (model/deck not found) as anki-error', () => {
    expect(classifyCardError('model "Basic" was not found')).toBe('anki-error');
    expect(classifyCardError('deck "English" was not found')).toBe('anki-error');
    expect(classifyCardError('notetype was not found: Kivara')).toBe('anki-error');
  });

  it('never reads the literal "AnkiConnect" as a network failure', () => {
    const sentence = 'AnkiConnect error: model "X" was not found';
    expect(classifyCardError(sentence)).not.toBe('anki-down');
    expect(classifyCardError(sentence)).toBe('anki-error');
  });

  it('still reads a raw transport failure as anki-down', () => {
    expect(classifyCardError('TypeError: Failed to fetch')).toBe('anki-down');
    expect(classifyCardError('connect ECONNREFUSED 127.0.0.1:8765')).toBe('anki-down');
    expect(classifyCardError('fetch failed')).toBe('anki-down');
  });

  it('reads the wrapped network sentence through its transport code', () => {
    // The message names "AnkiConnect", which by design is not a network
    // signal; the code is what carries the transport verdict.
    const sentence = message('es', 'anki.network', { reason: 'Failed to fetch' });
    expect(classifyCardError(sentence, 'NETWORK')).toBe('anki-down');
  });

  it('reads the loopback refusal through its transport code', () => {
    const sentence = message('es', 'anki.loopbackRefused');
    expect(classifyCardError(sentence, 'LOOPBACK_REFUSED')).toBe('anki-down');
  });
});

describe('the transport code wins over the message', () => {
  const passThrough: Array<[AnkiPingErrorCode, string]> = [
    ['TIMEOUT', 'timeout'],
    ['API_KEY', 'api-key'],
    ['NETWORK', 'anki-down'],
    ['CORS', 'anki-down'],
    ['LOOPBACK_REFUSED', 'anki-down'],
    ['ANKI', 'anki-error'],
    ['HTTP', 'anki-error'],
  ];

  for (const [code, expected] of passThrough) {
    it(`maps ${code} to ${expected}`, () => {
      expect(classifyCardError('anything', code)).toBe(expected);
    });
  }
});

describe('showCardSaveError renders the code label, not the provider sentence', () => {
  const RAW = 'AnkiConnect responded with 500.';

  function lastDescription(): string {
    const calls = vi.mocked(toast.error).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const options = calls[calls.length - 1][1] as { description?: string };
    return options.description ?? '';
  }

  it('makes the code label the description', () => {
    showCardSaveError(RAW, false, undefined, undefined, 'anki-error');
    const label = t(CARD_ERROR_LABEL_KEYS['anki-error']);
    expect(label).not.toBe(RAW);
    expect(lastDescription()).toBe(`${label} — ${RAW}`);
    expect(lastDescription().startsWith(label)).toBe(true);
  });

  it('keeps the label alone when the provider text is absent', () => {
    showCardSaveError(undefined, false, undefined, undefined, 'timeout');
    expect(lastDescription()).toBe(t(CARD_ERROR_LABEL_KEYS.timeout));
  });

  it('keeps the raw text as a secondary detail, never as the description', () => {
    showCardSaveError(RAW, false, undefined, undefined, 'anki-error');
    const description = lastDescription();
    // The raw sentence is present, but suffixed — it is the detail, not the
    // headline the user reads first.
    expect(description).toContain(RAW);
    expect(description).not.toBe(RAW);
    expect(description.indexOf(RAW)).toBeGreaterThan(
      description.indexOf(t(CARD_ERROR_LABEL_KEYS['anki-error'])),
    );
  });

  it('still says a queued card waits in the retry queue', () => {
    showCardSaveError(RAW, true, undefined, undefined, 'anki-down');
    const label = t(CARD_ERROR_LABEL_KEYS['anki-down']);
    expect(lastDescription()).toBe(`${label} — ${RAW} ${t('queue.willRetry')}`);
  });

  it('keeps the legacy shape for a call with no code', () => {
    showCardSaveError(RAW);
    expect(lastDescription()).toBe(RAW);
  });
});
