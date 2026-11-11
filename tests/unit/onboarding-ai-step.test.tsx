/**
 * AIStep — the two fields the prototype carries beyond the repo's version:
 * a free-text model id next to the preset list, and the cache TTL selector.
 *
 * Both write through the SAME store fields the settings tab uses
 * (`ai.model` and `ai.cacheTtlDays`); no onboarding-only state is invented.
 * The custom id is a UI mode, so a sentinel never reaches `ai.model`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIStep, type AIStepProps } from '../../src/onboarding/steps/AIStep';

function setup(overrides: Partial<AIStepProps> = {}) {
  const props: AIStepProps = {
    aiProvider: 'openai',
    setAiProvider: vi.fn(),
    aiApiKey: 'sk-test',
    setAiApiKey: vi.fn(),
    aiModel: 'gpt-4o-mini',
    setAiModel: vi.fn(),
    aiEnrichOnSave: false,
    setAiEnrichOnSave: vi.fn(),
    aiEnrichOnHover: false,
    setAiEnrichOnHover: vi.fn(),
    aiCacheTtlDays: 30,
    setAiCacheTtlDays: vi.fn(),
    aiBaseUrl: '',
    setAiBaseUrl: vi.fn(),
    aiApiFormat: 'openai-chat',
    setAiApiFormat: vi.fn(),
    ...overrides,
  };
  const view = render(<AIStep {...props} />);
  return { ...view, props };
}

/** Stand-in for the optional host-permission API the unit environment lacks. */
function stubPermissions(granted: boolean) {
  const request = vi.fn().mockResolvedValue(granted);
  (globalThis as unknown as { chrome: Record<string, unknown> }).chrome.permissions = {
    request,
    getAll: vi.fn().mockResolvedValue({ origins: [] }),
  };
  return request;
}

afterEach(() => {
  const g = globalThis as unknown as { chrome?: { permissions?: unknown } };
  if (g.chrome) delete g.chrome.permissions;
});

const modelSelect = (): HTMLSelectElement =>
  screen.getByTestId('onboarding-ai-model') as HTMLSelectElement;

describe('AIStep custom model', () => {
  it('offers a free-text id next to the presets and writes it to ai.model', () => {
    const { props } = setup();
    fireEvent.change(modelSelect(), { target: { value: '__custom__' } });
    const input = screen.getByTestId('onboarding-ai-custom-model') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'my-private-model' } });
    expect(props.setAiModel).toHaveBeenLastCalledWith('my-private-model');
  });

  it('keeps a saved custom id visible instead of rendering an empty select', () => {
    setup({ aiModel: 'my-private-model' });
    expect(modelSelect().value).toBe('__custom__');
    expect((screen.getByTestId('onboarding-ai-custom-model') as HTMLInputElement).value).toBe('my-private-model');
  });

  it('going back to a preset closes the free-text input', () => {
    const { props, rerender } = setup({ aiModel: 'my-private-model' });
    fireEvent.change(modelSelect(), { target: { value: 'gpt-4o' } });
    expect(props.setAiModel).toHaveBeenLastCalledWith('gpt-4o');
    // The parent writes the preset back into `ai.model`; the input follows.
    rerender(<AIStep {...props} aiModel="gpt-4o" />);
    expect(screen.queryByTestId('onboarding-ai-custom-model')).toBeNull();
  });
});

describe('AIStep cache TTL', () => {
  it('renders the day options and writes the choice to ai.cacheTtlDays', () => {
    const { props } = setup({ aiCacheTtlDays: 30 });
    const ttl = screen.getByTestId('onboarding-ai-cache-ttl') as HTMLSelectElement;
    expect(ttl.value).toBe('30');
    expect([...ttl.options].map((o) => o.value)).toEqual(['1', '7', '14', '30', '60', '90']);
    fireEvent.change(ttl, { target: { value: '14' } });
    expect(props.setAiCacheTtlDays).toHaveBeenCalledWith(14);
  });

  it('keeps an off-list TTL saved from the Settings slider', () => {
    setup({ aiCacheTtlDays: 45 });
    const ttl = screen.getByTestId('onboarding-ai-cache-ttl') as HTMLSelectElement;
    expect(ttl.value).toBe('45');
    expect([...ttl.options].some((o) => o.value === '45')).toBe(true);
  });
});

describe('AIStep provider mosaic (prototype port)', () => {
  it('offers the prototype tile list including the Custom (openai-compatible) tile', () => {
    const { props } = setup();
    const tiles = screen.getAllByRole('radio').map((el) => el.textContent ?? '');
    expect(tiles).toHaveLength(5);
    expect(tiles[4]).toContain('Personalizado');
    expect(tiles[4]).toContain('Cualquier proveedor o servidor local: tú pones URL, formato y modelo.');
    fireEvent.click(screen.getByRole('radio', { name: /Personalizado/ }));
    expect(props.setAiProvider).toHaveBeenCalledWith('openai-compatible');
    // The Custom tile carries no default model: the free text stays as is.
    expect(props.setAiModel).not.toHaveBeenCalled();
  });

  it('switching providers restores the default when the saved id belongs elsewhere', () => {
    const { props } = setup({ aiModel: 'gpt-4o-mini' });
    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
    expect(props.setAiModel).toHaveBeenCalledWith('claude-haiku-4-5');
  });
});

describe('AIStep per-origin permission flow (same helpers as AiByokSection)', () => {
  it('saving a curated endpoint requests exactly its origin', async () => {
    const request = stubPermissions(true);
    setup({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://openrouter.ai/api/v1' });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar endpoint' }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({ origins: ['https://openrouter.ai/*'] });
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a denial reads as the standard grant-access note', async () => {
    stubPermissions(false);
    setup();
    fireEvent.click(screen.getByRole('radio', { name: /OpenAI/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Concede el acceso al proveedor');
  });

  it('a non-curated URL is refused before any permission request', async () => {
    setup({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://evil.example.com/v1' });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar endpoint' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('no está en la lista compatible');
  });
});

describe('AIStep compat endpoint editor', () => {
  it('a curated chip fills the base URL and the suggested model', () => {
    const { props } = setup({ aiProvider: 'openai-compatible', aiBaseUrl: '' });
    fireEvent.click(screen.getByRole('button', { name: 'OpenRouter' }));
    expect(props.setAiBaseUrl).toHaveBeenCalledWith('https://openrouter.ai/api/v1');
    expect(props.setAiModel).toHaveBeenCalledWith('openrouter/auto');
  });

  it('the wire format is a select with the prototype info hint beside the label', () => {
    const { container, props } = setup({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1' });
    expect(container.querySelector('.kvl-hint')).not.toBeNull();
    const format = screen.getByTestId('onboarding-ai-format') as HTMLSelectElement;
    expect(format.value).toBe('openai-chat');
    fireEvent.change(format, { target: { value: 'anthropic-messages' } });
    expect(props.setAiApiFormat).toHaveBeenCalledWith('anthropic-messages');
  });
});

describe('AIStep API key field', () => {
  it('the key goes through the guarded SecretKeyInput and commits on blur', () => {
    const { props } = setup();
    const input = screen.getByPlaceholderText(/guardada/) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-new' } });
    fireEvent.blur(input);
    expect(props.setAiApiKey).toHaveBeenCalledWith('sk-new');
  });
});
