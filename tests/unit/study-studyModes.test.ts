import { describe, expect, it } from 'vitest';
import {
  isTranslationMode,
  LISTEN_FIRST_KEY,
  NEXT_TRANSLATION,
  TRANSLATION_KEY,
  TRANSLATION_MODES,
} from '../../src/shared/study/studyModes';

describe('studyModes · isTranslationMode', () => {
  it('accepts the three valid modes', () => {
    expect(isTranslationMode('visible')).toBe(true);
    expect(isTranslationMode('blur')).toBe(true);
    expect(isTranslationMode('hidden')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isTranslationMode('nope')).toBe(false);
    expect(isTranslationMode(undefined)).toBe(false);
    expect(isTranslationMode(null)).toBe(false);
  });
});

describe('studyModes · NEXT_TRANSLATION', () => {
  it('cycles visible → blur → hidden → visible', () => {
    expect(NEXT_TRANSLATION.visible).toBe('blur');
    expect(NEXT_TRANSLATION.blur).toBe('hidden');
    expect(NEXT_TRANSLATION.hidden).toBe('visible');
  });
});

describe('studyModes · constants', () => {
  it('lists the modes in order', () => {
    expect(TRANSLATION_MODES).toEqual(['visible', 'blur', 'hidden']);
  });

  it('pins the storage keys', () => {
    expect(TRANSLATION_KEY).toBe('kvl:translation');
    expect(LISTEN_FIRST_KEY).toBe('kvl:listenFirst');
  });
});
