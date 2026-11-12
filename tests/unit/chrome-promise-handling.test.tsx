/**
 * chrome-promise-handling — the fallbacks the sync try/catch could never run.
 *
 * chrome.* MV3 APIs reject ASYNCHRONOUSLY: a synchronous `try { chrome.x(...) }
 * catch {}` never sees the rejection, so the fallback silently never fired.
 * The flagged site is WordPopover's action-row open ("Define"/"See in Anki"
 * share it): it asks the service worker to open the URL (chrome.tabs) and must
 * fall back to window.open when the sendMessage promise REJECTS (SW asleep,
 * no receiver yet). These tests pin that contract from both sides.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { WordPopover } from '../../src/content/ui/WordPopover';

// chrome.runtime.sendMessage is the bare vi.fn() from tests/setup.ts.
const sendMessageMock = chrome.runtime.sendMessage as unknown as Mock<(...args: any[]) => any>;

function renderPopover() {
  return render(
    <WordPopover
      visible
      onMouseEnter={() => {}}
      onMouseLeave={() => {}}
      token="water"
      sentence="She drank the water."
      sourceLang="en"
      includeAi={false}
      kind="unknown"
      isExpanded={false}
      isSaved={false}
      parentMWE={null}
      onToggleExpand={() => {}}
      onRejoinParent={() => {}}
      onSave={() => {}}
    />,
  );
}

// The action row's dictionary button, found by its title (both locales say
// "Cambridge"; setup.ts pins the locale to es, so the exact string is
// "Abrir en Cambridge / WordReference").
async function findDefineAction() {
  const buttons = await screen.findAllByRole('button');
  const define = buttons.find((b) => (b.getAttribute('title') ?? '').includes('Cambridge'));
  expect(define, 'the Define action row button should render').toBeTruthy();
  return define!;
}

describe('chrome promise rejection fallbacks', () => {
  it('falls back to window.open when sendMessage rejects', async () => {
    sendMessageMock.mockRejectedValueOnce(new Error('receiving end does not exist'));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPopover();
    fireEvent.click(await findDefineAction());

    await vi.waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    const [url, target, features] = openSpy.mock.calls[0];
    expect(String(url)).toContain('dictionary.cambridge.org');
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
    // The message still goes out first — window.open is only the fallback.
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPEN_URL' }),
    );
  });

  it('does NOT fall back when the service worker resolves the open', async () => {
    sendMessageMock.mockResolvedValueOnce(undefined);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPopover();
    fireEvent.click(await findDefineAction());

    await vi.waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OPEN_URL' }),
      );
    });
    // Give any stray fallback a full tick to (wrongly) fire.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(openSpy).not.toHaveBeenCalled();
  });
});
