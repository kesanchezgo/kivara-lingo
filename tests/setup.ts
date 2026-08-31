/**
 * Vitest global setup. Mocks browser APIs that don't exist in happy-dom
 * but are referenced by our modules (chrome.*, webext-bridge, etc.).
 */
import { vi } from 'vitest';

// Minimal chrome.* API mock so imports that reference chrome don't crash.
const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    getURL: (path: string) => `chrome-extension://test/${path}`,
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
