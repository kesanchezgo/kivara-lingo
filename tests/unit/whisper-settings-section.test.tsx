/**
 * Whisper's Settings surface, rendered for real.
 *
 * Three states, one decision each: which one a user lands in is not cosmetic,
 * it is whether the extension quietly permits a click it cannot honour.
 *
 *   1. Glue packaged (`WHISPER_BUILD && WHISPER_GLUE_PACKAGED`) — the switch
 *      is live and the URL fields accept input with an inline verdict.
 *   2. Glue compiled in but not packaged — the switch exists, disabled, with
 *      the reason attached, rather than a control that turns Whisper on and can
 *      only fail afterwards.
 *   3. Compiled out — the flag's compile-time branch, and no control at all.
 *
 * The URL verdict is asserted by interaction (`type` + `blur`, then the inline
 * alert), so it tests the checker the user meets rather than the checker in
 * isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WhisperAsrSection } from '../../src/app/components/tabs/settings-primitives';
import { useKivaraStore } from '../../src/shared/store';
import { WHISPER_MODEL_PRESETS } from '../../src/shared/whisper-presets';

/** Which of the build combinations the flag reads as today. */
const flagState = { build: true, packaged: false };
vi.mock('../../src/shared/whisper-flag', () => ({
  get WHISPER_BUILD() {
    return flagState.build;
  },
  get WHISPER_GLUE_PACKAGED() {
    return flagState.packaged;
  },
}));

describe('WhisperAsrSection, glue packaged', () => {
  beforeEach(() => {
    flagState.build = true;
    flagState.packaged = true;
    useKivaraStore.setState({
      asr: { ...useKivaraStore.getState().asr, enabled: true, model: 'tiny', modelUrl: undefined },
    });
  });
  afterEach(cleanup);

  /** The override field, distinguishable from the glue field by placeholder. */
  const modelField = (): HTMLInputElement =>
    screen.getByPlaceholderText(WHISPER_MODEL_PRESETS.tiny.url) as HTMLInputElement;

  it('offers a live switch', () => {
    render(<WhisperAsrSection />);
    const toggle = screen.getAllByRole('switch')[0];
    expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('rejects a private or loopback address as the user leaves the field', async () => {
    render(<WhisperAsrSection />);
    fireEvent.change(modelField(), { target: { value: 'http://127.0.0.1/model.bin' } });
    // The verdict is rendered continuously, so it is already there before blur.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeTruthy();
    });
    // A verdict that only appeared on `change` would miss a paste, and one that
    // only appeared on blur would appear after the user has already left.
    fireEvent.blur(modelField());
    expect(screen.queryByRole('alert')).toBeTruthy();
  });

  it('accepts the preset URL with no alert', async () => {
    render(<WhisperAsrSection />);
    fireEvent.change(modelField(), { target: { value: WHISPER_MODEL_PRESETS.tiny.url } });
    fireEvent.blur(modelField());
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

describe('WhisperAsrSection, glue compiled in but not packaged', () => {
  beforeEach(() => {
    flagState.build = true;
    flagState.packaged = false;
    useKivaraStore.setState({
      asr: { ...useKivaraStore.getState().asr, enabled: false },
    });
  });
  afterEach(cleanup);

  it('renders the switch disabled, with the reason', async () => {
    render(<WhisperAsrSection />);
    const toggle = screen.getAllByRole('switch')[0];
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    // And clicking it does nothing, which is what `disabled` has to mean: not
    // "ignored by the handler", but ignored.
    await waitFor(() => {
      expect(useKivaraStore.getState().asr.enabled).toBe(false);
    });
    fireEvent.click(toggle);
    expect(useKivaraStore.getState().asr.enabled).toBe(false);
  });

  it('says the reason out loud', () => {
    render(<WhisperAsrSection />);
    expect(screen.getByText(/No disponible en este build/i)).toBeTruthy();
  });
});

describe('WhisperAsrSection, compiled out', () => {
  beforeEach(() => {
    flagState.build = false;
    flagState.packaged = false;
    useKivaraStore.setState({
      asr: { ...useKivaraStore.getState().asr, enabled: false },
    });
  });
  afterEach(cleanup);

  it('renders no control at all', () => {
    render(<WhisperAsrSection />);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText(/No disponible en este build/i)).toBeTruthy();
  });
});
