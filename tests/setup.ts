/**
 * Vitest global setup. Mocks browser APIs that don't exist in happy-dom
 * but are referenced by our modules (chrome.*, webext-bridge, etc.).
 */
import { vi } from 'vitest';

// Deliberately NOT configuring the unhandled-rejection attribution here.
//
// Vitest reports an unhandled rejection against whichever task is running when
// it surfaces, so a Dexie promise left dangling by an earlier test once showed
// as a bare `STACK_TRACE_ERROR` inside `orchestrator-exports` — a file that
// could not throw from the line named, which made a real defect unfalsifiable.
// Two remedies were tried here and both are wrong, recorded so nobody repeats
// them:
//
//   • `vi.onUnhandledRejection` does not exist in Vitest 4 as a global `vi`
//     method (it is a reporter/config concern). Calling it breaks every test
//     file in the run with `TypeError: not a function`.
//   • Throwing from a `process.on('unhandledRejection')` handler crashes every
//     file too: it re-attributes nothing, it just escapes the harness.
//
// The working lever is `dangerouslyIgnoreUnhandledErrors: false` in
// vitest.config.ts, which keeps Vitest's own per-file reporting of
// `unhandledErrors`. When a `STACK_TRACE_ERROR` shows up there, the file is
// listed because it was running, not because it was guilty — read the
// `unhandledErrors` array in the JSON reporter for the stack of the real
// offender.




// Minimal chrome.* API mock so imports that reference chrome don't crash.
const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    getURL: (path: string) => `chrome-extension://test/${path}`,
  },
  // UI locale for src/shared/i18n — tests assert Spanish strings, so pin
  // it instead of letting detectLocale() fall through to navigator.language
  // (happy-dom reports en-US, which would silently switch every t() to EN).
  i18n: {
    getUILanguage: () => 'es',
  },
  cookies: {
    getAll: vi.fn().mockResolvedValue([]),
    getAllCookieStores: vi.fn().mockResolvedValue([{ id: '0', tabIds: [] }]),
    set: vi.fn().mockResolvedValue(undefined),
  },
  declarativeNetRequest: {
    updateSessionRules: vi.fn().mockResolvedValue(undefined),
  },
  storage: {
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
  },
  commands: {
    onCommand: { addListener: vi.fn() },
  },
};

(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

// Mock webext-bridge sendMessage (used by onboarding, popup, etc.)
vi.mock('webext-bridge/options', () => ({
  sendMessage: vi.fn().mockResolvedValue({}),
}));
vi.mock('webext-bridge/popup', () => ({
  sendMessage: vi.fn().mockResolvedValue({}),
}));
vi.mock('webext-bridge/content-script', () => ({
  sendMessage: vi.fn().mockResolvedValue({}),
  onMessage: vi.fn(),
}));
