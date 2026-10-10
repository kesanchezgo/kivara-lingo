/**
 * The permission strip is the ONLY action a held-back word can offer: the card
 * itself cannot grant origins (a prompt needs a user gesture, and options/ is
 * not web-accessible so `window.open` never worked), so its job is to ask the
 * service worker to open Ajustes for the right section. That message used to
 * go out on a raw `chrome.runtime.sendMessage` while the SW answers only on the
 * webext-bridge — dropped silently — and the click handler also fired a
 * blocked `window.open`, which is why the strip read as inert.
 *
 * The real SW and its real piped streams are out of range for a unit test, so
 * this renders the card with `needsAccess` and asserts the outbound message:
 * same bridge call the SW registers for, same payload, no second navigation.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendMessage } from 'webext-bridge/content-script';
import { WordPopover } from '../../src/content/ui/WordPopover';

const BASE_PROPS = {
  visible: true,
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  token: 'run',
  lookupToken: 'run',
  sentence: 'She ran home.',
  sourceLang: 'en',
  includeAi: false,
  kind: 'single' as const,
  mweKind: null,
  lemma: 'run',
  isExpanded: false,
  isSaved: false,
  parentMWE: null,
  onToggleExpand: () => {},
  onRejoinParent: () => {},
  onSave: () => {},
};

describe('the held-back strip', () => {
  beforeEach(() => {
    vi.mocked(sendMessage).mockClear();
  });

  it('asks the service worker to open Ajustes on Permisos', async () => {
    // Feed the card through the same contract the streaming port uses: the
    // `done` phase carries `needsAccess`. The SW is out of unit range, so the
    // port is driven directly; what is under test is the button that the
    // resulting state renders.
    const makeQueue = () => {
      const cbs: Array<(m: unknown) => void> = [];
      return { addListener: (cb: (m: unknown) => void) => cbs.push(cb), fire: (m: unknown) => cbs.forEach((cb) => cb(m)) };
    };
    const messageQ = makeQueue();
    const doneQ = makeQueue();
    vi.stubGlobal('chrome', {
      runtime: {
        connect: () => ({
          name: 'kvl-resolve-word',
          onMessage: {
            addListener: messageQ.addListener as unknown as (cb: unknown) => void,
          },
          onDisconnect: {
            addListener: doneQ.addListener as unknown as (cb: unknown) => void,
          },
          postMessage: (msg: unknown) => {
            if ((msg as { kind?: string })?.kind === 'resolve-word') {
              setTimeout(() => {
                messageQ.fire({ phase: 'done', needsAccess: [{ source: 'cambridge', group: 'dict:cambridge' }] });
              }, 0);
            }
          },
          disconnect: () => {},
        }),
        getURL: (p: string) => `chrome-extension://test/${p}`,
      },
      permissions: { getAll: async () => ({ origins: [] }), contains: async () => false },
      storage: {
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
      i18n: { getUILanguage: () => 'es' },
    });

    render(<WordPopover {...BASE_PROPS} />);

    // The strip appears only for a held-back result; its title lists them.
    const strip = await screen.findByTitle(/cambridge/);
    strip.click();

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        'OPEN_SETTINGS',
        { section: 'perm' },
        'background',
      ),
    );
  });
});
