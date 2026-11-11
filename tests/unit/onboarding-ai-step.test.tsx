/**
 * AIStep — the two fields the prototype carries beyond the repo's version:
 * a free-text model id next to the preset list, and the cache TTL selector.
 *
 * Both write through the SAME store fields the settings tab uses
 * (`ai.model` and `ai.cacheTtlDays`); no onboarding-only state is invented.
 * The custom id is a UI mode, so a sentinel never reaches `ai.model`.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
    ...overrides,
  };
  const view = render(<AIStep {...props} />);
  return { ...view, props };
}

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