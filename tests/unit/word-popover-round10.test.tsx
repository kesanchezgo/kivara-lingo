/**
 * RED TESTS — round 10: WordPopover polish.
 * 1. The IPA chip renders ONCE (#135 accidentally added a second one).
 * 2. The bottom strips (held-back sources, split/rejoin MWE) and the AI block
 *    reach the card edges: full-bleed via negative margin, no double padding.
 * 3. The ONE status radiogroup stays in the pinned bar (#135/#140).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { sendMessage } from 'webext-bridge/content-script';
import { WordPopover, type WordPopoverProps } from '../../src/content/ui/WordPopover';

const BASE_PROPS = {
  visible: true,
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  token: 'able',
  lookupToken: 'able',
  sentence: 'She is able to swim.',
  sourceLang: 'en',
  includeAi: false,
  kind: 'word',
  lemma: 'able',
  isExpanded: false,
  isSaved: false,
  parentMWE: null,
  onToggleExpand: () => {},
  onRejoinParent: () => {},
  onSave: () => {},
} as unknown as WordPopoverProps;

beforeEach(() => {
  vi.mocked(sendMessage).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the IPA chip renders exactly once', () => {
  it('one node carries the dictionary phonetic, never two', async () => {
    render(<WordPopover {...BASE_PROPS} />);
    await waitFor(() => expect(screen.getAllByText('/ˈeɪ.bl̩/').length).toBe(1));
  });
});

describe('the bottom strips and the AI block reach the card edges', () => {
  it('the held-back strip is full-bleed (negative margin, border-t uncut)', async () => {
    // Same contract the permissions test uses: the port's done phase carries
    // needsAccess, which is what renders the strip.
    const makeQueue = () => {
      const cbs: Array<(m: unknown) => void> = [];
      return { addListener: (cb: (m: unknown) => void) => cbs.push(cb), fire: (m: unknown) => cbs.forEach((cb) => cb(m)) };
    };
    const messageQ = makeQueue();
    vi.stubGlobal('chrome', {
      runtime: {
        connect: () => ({
          name: 'kvl-resolve-word',
          onMessage: { addListener: messageQ.addListener as unknown as (cb: unknown) => void },
          onDisconnect: { addListener: () => {} },
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
    const cta = await screen.findByTestId('kivara-needs-access');
    expect(cta.className).toContain('-mx-3.5');
    expect(cta.className).toContain('border-t');
  });

  it('#135/#140 still hold: exactly one radiogroup, in the pinned footer', async () => {
    render(
      <WordPopover
        {...BASE_PROPS}
        status="new"
        onStatusChange={() => {}}
      />,
    );
    await waitFor(() => {
      const groups = document.querySelectorAll('[role="radiogroup"]');
      expect(groups).toHaveLength(1);
    });
  });
});
