/**
 * Sentence-audio advice in the "card saved" notice (parity block 4).
 *
 * The prototype spends the FIRST audio-less card of a session explaining how to
 * turn capture on (naming the save combo when the user has one), then falls
 * back to the plain line. `withAudioHint` is that rule as a pure function: the
 * service worker reports a missing track as `capture.audioInactive`, and the
 * hint must never appear while capture is active — there the warning is a real
 * failure and replacing it would hide it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../../src/shared/i18n';
import { resetAudioHintForTests, takeAudioHintOnce, withAudioHint } from '../../src/content/ui/save-actions';

const INACTIVE = () => t('capture.audioInactive');

beforeEach(() => {
  resetAudioHintForTests();
});

afterEach(() => {
  resetAudioHintForTests();
});

describe('takeAudioHintOnce', () => {
  it('answers true exactly once per session', () => {
    expect(takeAudioHintOnce()).toBe(true);
    expect(takeAudioHintOnce()).toBe(false);
    expect(takeAudioHintOnce()).toBe(false);
  });

  it('starts over after the test reset', () => {
    takeAudioHintOnce();
    resetAudioHintForTests();
    expect(takeAudioHintOnce()).toBe(true);
  });
});

describe('withAudioHint', () => {
  it('names the save combo on the first audio-less card', () => {
    const out = withAudioHint([INACTIVE()], { audioCaptureActive: false, combo: 'Ctrl+Shift+S' });
    expect(out).toEqual([t('app.noAudioHint', { combo: 'Ctrl+Shift+S' })]);
  });

  it('drops the combo mention when the user has no save binding', () => {
    const out = withAudioHint([INACTIVE()], { audioCaptureActive: false });
    expect(out).toEqual([t('app.noAudioHintNoKey')]);
  });

  it('falls back to the plain line on later cards of the same session', () => {
    withAudioHint([INACTIVE()], { audioCaptureActive: false, combo: 'Alt+S' });
    const out = withAudioHint([INACTIVE()], { audioCaptureActive: false, combo: 'Alt+S' });
    expect(out).toEqual([t('app.noAudio')]);
  });

  it('never rewrites the warning while capture is active', () => {
    const warnings = [INACTIVE(), 'other'];
    expect(withAudioHint(warnings, { audioCaptureActive: true, combo: 'Alt+S' })).toBe(warnings);
  });

  it('leaves unrelated warnings untouched and keeps their order', () => {
    const out = withAudioHint(['first', INACTIVE(), 'last'], { audioCaptureActive: false });
    expect(out).toEqual(['first', t('app.noAudioHintNoKey'), 'last']);
  });

  it('does not spend the once-per-session hint when there is nothing to say', () => {
    withAudioHint([], { audioCaptureActive: false });
    // Still the first real audio-less card.
    const out = withAudioHint([INACTIVE()], { audioCaptureActive: false, combo: 'Alt+S' });
    expect(out).toEqual([t('app.noAudioHint', { combo: 'Alt+S' })]);
  });
});
