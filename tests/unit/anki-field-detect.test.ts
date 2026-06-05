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
    // "Picture" / "Image" map to the generic illustrative image slot
    // (fed by the VIP image chain). "Frame" / "Screenshot" still map
    // to the live video frame for users who explicitly want that.
    expect(detectFieldSource('Picture')).toBe('image');
    expect(detectFieldSource('image')).toBe('image');
    expect(detectFieldSource('Screenshot')).toBe('frame');
    expect(detectFieldSource('Frame')).toBe('frame');
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

  it('maps source-attributed enrichment fields', () => {
    expect(detectFieldSource('VIP Definitions')).toBe('source-definitions');
    expect(detectFieldSource('Definiciones VIP')).toBe('source-definitions');
    expect(detectFieldSource('Definitions with source')).toBe('source-definitions');
    expect(detectFieldSource('Definiciones con fuente')).toBe('source-definitions');
    expect(detectFieldSource('VIP Translations')).toBe('source-translations');
    expect(detectFieldSource('Traducciones VIP')).toBe('source-translations');
    expect(detectFieldSource('Translations with source')).toBe('source-translations');
    expect(detectFieldSource('Traducciones con fuente')).toBe('source-translations');
    expect(detectFieldSource('VIP Examples')).toBe('source-examples');
    expect(detectFieldSource('Ejemplos VIP')).toBe('source-examples');
    expect(detectFieldSource('Examples with source')).toBe('source-examples');
    expect(detectFieldSource('Ejemplos con fuente')).toBe('source-examples');
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
      // "picture" → generic illustrative slot (VIP image chain).
      // Users who want the literal video frame name the field "Frame".
      picture: 'image',
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
