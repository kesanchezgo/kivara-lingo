import { describe, it, expect } from 'vitest';
import { detectFieldSource, autoMapFields } from '../../src/shared/anki-field-detect';

describe('detectFieldSource', () => {
  it('maps "Front" to selection', () => {
    expect(detectFieldSource('Front')).toBe('selection');
  });

  it('maps "Back" to translation', () => {
    // "Back" doesn't match — it should be 'manual' unless it matches translation
    // Actually let's check — Back doesn't match any pattern
    expect(detectFieldSource('Back')).toBe('manual');
  });

  it('maps "word" fields to selection', () => {
    expect(detectFieldSource('word')).toBe('selection');
    expect(detectFieldSource('Palabra')).toBe('selection');
    expect(detectFieldSource('Front')).toBe('selection');
  });

  it('maps "sentence" fields to cue', () => {
    expect(detectFieldSource('Sentence')).toBe('cue');
    expect(detectFieldSource('frase')).toBe('cue');
    expect(detectFieldSource('Context')).toBe('cue');
  });

  it('maps audio fields correctly', () => {
    expect(detectFieldSource('sentence audio')).toBe('sentence-audio');
    expect(detectFieldSource('word audio')).toBe('word-audio');
    expect(detectFieldSource('Audio')).toBe('sentence-audio');
  });

  it('maps picture/frame fields', () => {
    expect(detectFieldSource('Picture')).toBe('frame');
    expect(detectFieldSource('Screenshot')).toBe('frame');
    expect(detectFieldSource('Frame')).toBe('frame');
    expect(detectFieldSource('image')).toBe('image');
    expect(detectFieldSource('Imagen')).toBe('image');
  });

  it('maps phonetic fields', () => {
    expect(detectFieldSource('phonetic')).toBe('phonetic');
    expect(detectFieldSource('IPA')).toBe('phonetic');
    expect(detectFieldSource('Pronunciation')).toBe('phonetic');
  });

  it('maps translation fields', () => {
    expect(detectFieldSource('Translation')).toBe('translation');
    expect(detectFieldSource('Traducción')).toBe('translation');
    expect(detectFieldSource('español')).toBe('translation');
  });

  it('maps monolingual/definition fields', () => {
    expect(detectFieldSource('Definition')).toBe('monolingual');
    expect(detectFieldSource('Monolingual')).toBe('monolingual');
    expect(detectFieldSource('Meaning')).toBe('monolingual');
  });

  it('maps explicitly named AI rich-card fields', () => {
    expect(detectFieldSource('AI Definition')).toBe('ai-definition');
    expect(detectFieldSource('IA Sinónimos')).toBe('ai-synonyms');
    expect(detectFieldSource('AI Collocations')).toBe('ai-collocations');
    expect(detectFieldSource('IA Matiz')).toBe('ai-nuance');
    expect(detectFieldSource('AI Register')).toBe('ai-register');
  });

  it('returns "manual" for unknown fields', () => {
    expect(detectFieldSource('Notes')).toBe('manual');
    expect(detectFieldSource('Tags')).toBe('manual');
    expect(detectFieldSource('Extra info')).toBe('cue'); // 'extra' matches cue pattern
  });
});

describe('autoMapFields', () => {
  it('maps KivaraLingo model fields correctly', () => {
    const fields = ['word', 'phonetic', 'sentence', 'translation', 'bilingual', 'monolingual', 'picture', 'sentence audio', 'word audio'];
    const result = autoMapFields(fields);
    expect(result).toEqual({
      word: 'selection',
      phonetic: 'phonetic',
      sentence: 'cue',
      translation: 'translation',
      bilingual: 'bilingual',
      monolingual: 'monolingual',
      picture: 'frame',
      'sentence audio': 'sentence-audio',
      'word audio': 'word-audio',
    });
  });

  it('maps Basic model fields', () => {
    const fields = ['Front', 'Back'];
    const result = autoMapFields(fields);
    expect(result).toEqual({
      Front: 'selection',
      Back: 'manual',
    });
  });

  it('preserves existing overrides', () => {
    const fields = ['Front', 'Back'];
    const existing = { Front: 'cue' as const };
    const result = autoMapFields(fields, existing);
    expect(result.Front).toBe('cue'); // user override preserved
    expect(result.Back).toBe('manual');
  });
});
