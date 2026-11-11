/**
 * Language registry (`shared/languages`).
 *
 * One list feeds Preferences › Language, the onboarding picker and the
 * resolver that guards a saved code: a language that is not open today must
 * never reach the store, or the app would ask for a dictionary it does not
 * have.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEARN_LANG,
  DEFAULT_NATIVE_LANG,
  LANGUAGES,
  canLearn,
  canSpeak,
  languageOf,
  resolveLearnLang,
  resolveNativeLang,
  wordJoiner,
} from '../../src/shared/languages';

describe('LANGUAGES', () => {
  it('declares each code once and opens exactly the en → es pair', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(LANGUAGES.filter((l) => l.learn).map((l) => l.code)).toEqual(['en']);
    expect(LANGUAGES.filter((l) => l.speak).map((l) => l.code)).toEqual(['es']);
    expect(codes).toContain('ja');
  });

  it('falls back to the first entry for an unknown code', () => {
    expect(languageOf('xx')).toBe(LANGUAGES[0]);
    expect(languageOf('ja').segmentation).toBe('dictionary');
  });
});

describe('canLearn / canSpeak', () => {
  it('accepts only the open slot', () => {
    expect(canLearn('en')).toBe(true);
    expect(canLearn('es')).toBe(false);
    expect(canSpeak('es')).toBe(true);
    expect(canSpeak('en')).toBe(false);
    expect(canSpeak('ja')).toBe(false);
  });
});

describe('resolveLearnLang / resolveNativeLang', () => {
  it('keeps an open language and rewrites a closed or malformed one', () => {
    expect(resolveLearnLang('en')).toBe('en');
    expect(resolveLearnLang('ja')).toBe(DEFAULT_LEARN_LANG);
    expect(resolveLearnLang(undefined)).toBe(DEFAULT_LEARN_LANG);
    expect(resolveLearnLang(42)).toBe(DEFAULT_LEARN_LANG);

    expect(resolveNativeLang('es')).toBe('es');
    expect(resolveNativeLang('en')).toBe(DEFAULT_NATIVE_LANG);
    expect(resolveNativeLang(null)).toBe(DEFAULT_NATIVE_LANG);
  });
});

describe('wordJoiner', () => {
  it('uses a space for spaced scripts and nothing for dictionary ones', () => {
    expect(wordJoiner('en')).toBe(' ');
    expect(wordJoiner('ja')).toBe('');
    expect(wordJoiner('zh')).toBe('');
  });
});