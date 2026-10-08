/**
 * Regression tests for the e2af3d3 review — SecretKeyInput contract.
 *
 * The masked-value approach (`value={maskSecret(stored)}`) corrupted keys:
 * the store holds plaintext in memory, so the input rendered `sk••••••`
 * and any keystroke (even Backspace on an untouched field) sent the MASKED
 * text to onChange, which encrypted and saved the mask itself.
 *
 * SecretKeyInput's contract: the draft starts EMPTY, the stored value is
 * never rendered, and onChange fires only with fresh user-typed text.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { SecretKeyInput } from '../../src/app/components/SecretKeyInput';

describe('SecretKeyInput', () => {
  it('never renders the stored secret, masked or otherwise', () => {
    const { container } = render(
      React.createElement(SecretKeyInput, {
        stored: 'sk-abc123-secret',
        onChange: () => {},
      }),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toContain('guardada');
    // The stored key must not appear anywhere in the DOM.
    expect(container.innerHTML).not.toContain('sk-abc123-secret');
    expect(container.innerHTML).not.toContain('sk••');
  });

  it('calls onChange only with fresh user text', () => {
    const seen: string[] = [];
    const { container } = render(
      React.createElement(SecretKeyInput, {
        stored: 'sk-abc123-secret',
        onChange: (v: string) => seen.push(v),
      }),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-brand-new-key' } });
    expect(seen).toEqual(['sk-brand-new-key']);
    // Untouched field = zero writes (the stored key survives).
    const seen2: string[] = [];
    render(
      React.createElement(SecretKeyInput, {
        stored: 'sk-abc123-secret',
        onChange: (v: string) => seen2.push(v),
      }),
    );
    expect(seen2).toEqual([]);
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
  });
});
