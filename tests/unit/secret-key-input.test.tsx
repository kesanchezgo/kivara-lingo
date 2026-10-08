/**
 * Regression tests for the 39dc790 review — SecretKeyInput contract.
 *
 * Two bugs pinned here:
 *  1. Masked-value corruption: `value={maskSecret(stored)}` rendered the
 *     mask and any keystroke saved it (`sk••••••`). The stored secret must
 *     never be rendered.
 *  2. Write-through reset: the first fix reset `draft` in
 *     `useEffect([stored])`, so every keystroke (which wrote through to
 *     `stored`) wiped the draft — typing saved only the LAST character.
 *     The harness below re-injects emitted values as `stored`, exactly
 *     like the real store does.
 */
import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { SecretKeyInput } from '../../src/app/components/SecretKeyInput';

/** Mirrors the real store: emit → stored updates → component re-renders. */
function Harness({ onStore }: { onStore?: (v: string) => void }) {
  const [stored, setStored] = useState('');
  return (
    <SecretKeyInput
      stored={stored}
      onChange={(v) => {
        setStored(v);
        onStore?.(v);
      }}
    />
  );
}

function inputOf(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input') as HTMLInputElement;
}

describe('SecretKeyInput', () => {
  it('never renders the stored secret, masked or otherwise', () => {
    const { container } = render(
      React.createElement(SecretKeyInput, {
        stored: 'sk-abc123-secret',
        onChange: () => {},
      }),
    );
    const input = inputOf(container);
    expect(input.value).toBe('');
    expect(input.placeholder).toContain('guardada');
    expect(container.innerHTML).not.toContain('sk-abc123-secret');
    expect(container.innerHTML).not.toContain('sk••');
    cleanup();
  });

  it('typing character-by-character saves the FULL key (write-through reset)', async () => {
    const seen: string[] = [];
    const { container } = render(React.createElement(Harness, { onStore: (v) => seen.push(v) }));
    const input = inputOf(container);
    for (const ch of 'sk-abc') {
      fireEvent.change(input, { target: { value: input.value + ch } });
      await Promise.resolve();
    }
    fireEvent.blur(input);
    await Promise.resolve();
    // Before the fix this was ['s','k','-','a','b','c'] with store === 'c'.
    expect(seen[seen.length - 1]).toBe('sk-abc');
    cleanup();
  });

  it('commits on blur, not per keystroke', async () => {
    const seen: string[] = [];
    const { container } = render(React.createElement(Harness, { onStore: (v) => seen.push(v) }));
    const input = inputOf(container);
    fireEvent.change(input, { target: { value: 'sk-one' } });
    await Promise.resolve();
    expect(seen).toEqual([]); // no per-keystroke writes
    fireEvent.blur(input);
    await Promise.resolve();
    expect(seen).toEqual(['sk-one']);
    cleanup();
  });

  it('leaves the store untouched while the field is never focused', async () => {
    const seen: string[] = [];
    const { container } = render(
      React.createElement(SecretKeyInput, {
        stored: 'sk-abc123-secret',
        onChange: (v: string) => seen.push(v),
      }),
    );
    expect(seen).toEqual([]);
    cleanup();
  });

  it('clears the key via the Quitar action (empty draft alone never deletes)', async () => {
    const seen: string[] = [];
    const { container, rerender } = render(
      React.createElement(SecretKeyInput, {
        stored: 'sk-abc123-secret',
        onChange: (v: string) => seen.push(v),
      }),
    );
    const clearBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Quitar'),
    );
    expect(clearBtn).toBeDefined();
    fireEvent.click(clearBtn!);
    expect(seen).toEqual(['']);
    // Re-render with the cleared value: no hint, no stored text.
    rerender(
      React.createElement(SecretKeyInput, {
        stored: '',
        onChange: (v: string) => seen.push(v),
      }),
    );
    expect(container.textContent).not.toContain('guardada');
    cleanup();
  });

  it('empty draft on blur does NOT clear a saved key', async () => {
    const seen: string[] = [];
    const { container } = render(
      React.createElement(SecretKeyInput, {
        stored: 'sk-already-saved',
        onChange: (v: string) => seen.push(v),
      }),
    );
    const input = inputOf(container);
    // Type one char, delete it, blur — the dirty-but-empty draft must not
    // emit '', which would silently wipe the stored key.
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await Promise.resolve();
    expect(seen).toEqual([]);
    cleanup();
  });

  it('commits a typed key on unmount (panel/popup closes without blur)', async () => {
    const seen: string[] = [];
    const { container, unmount } = render(
      React.createElement(SecretKeyInput, {
        stored: '',
        onChange: (v: string) => seen.push(v),
      }),
    );
    const input = inputOf(container);
    fireEvent.change(input, { target: { value: 'sk-typed-no-blur' } });
    await Promise.resolve();
    expect(seen).toEqual([]); // not committed yet
    unmount();
    await Promise.resolve();
    expect(seen).toEqual(['sk-typed-no-blur']);
    cleanup();
  });

  it('shows the re-enter hint for ciphertext unreadable on this device', () => {
    const { container } = render(
      React.createElement(SecretKeyInput, {
        stored: 'enc:v1:someciphertextblob',
        onChange: () => {},
      }),
    );
    expect(container.textContent).toContain('Vuelve a introducirla');
    expect(container.innerHTML).not.toContain('enc:v1:');
    cleanup();
  });
});
