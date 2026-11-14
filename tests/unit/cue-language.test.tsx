/**
 * Point 4 — the subtitle track can be in another language than the one the
 * user is learning.
 *
 * QA on Netflix: the episode's Spanish track was labelled with the learning
 * language (English), so every card looked up an English dictionary for
 * Spanish words and the rail/tag said `lang:en`. The track's REAL language
 * has to win: declared by the adapter (TTML xml:lang / VTT Language header /
 * the bus track) or detected from the cues, and never defaulted to the
 * learning language.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  declaredTrackLanguage,
  detectTrackLanguage,
  isLanguageMismatch,
  normalizeLang,
} from '../../src/content/ui/cue-language';
import { LanguageMismatchNotice } from '../../src/content/ui/language-mismatch';
import { ALL_MESSAGES } from '../../src/shared/i18n';
import type { SubtitleCue } from '../../src/content/platform-adapters/types';

const cue = (text: string, language = '', i = 0): SubtitleCue => ({
  id: `c${i}`,
  start: i,
  end: i + 1,
  text,
  language,
});

const SPANISH = [
  cue('El taxista dijo que probablemente ya esté en la ciudad, señor.', '', 0),
  cue('No los he visto en un mes, pero volverán mañana por la tarde.', '', 1),
  cue('Cuando vuelas de Buriatia a Chegdomyn no hay otra manera de llegar.', '', 2),
];
const ENGLISH = [
  cue('The taxi driver said he is probably in the city already, sir.', '', 0),
  cue('I have not seen them for a month, but they will come back tomorrow.', '', 1),
];

describe('track language', () => {
  it('normalizes BCP-47 to the two-letter code', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('ES_419')).toBe('es');
    expect(normalizeLang('')).toBe('');
    expect(normalizeLang(undefined)).toBe('');
  });

  it('uses the language the adapter declared on the cues', () => {
    expect(declaredTrackLanguage([cue('hola', 'es', 0), cue('adios', 'es', 1)])).toBe('es');
    expect(declaredTrackLanguage([cue('hola', 'es', 0), cue('bye', 'en', 1)])).toBe('');
  });

  it('detects the language from the cues when the adapter declared none', () => {
    expect(detectTrackLanguage(SPANISH)).toBe('es');
    expect(detectTrackLanguage(ENGLISH)).toBe('en');
    // A declared language always beats the heuristic.
    expect(detectTrackLanguage(SPANISH, 'fr')).toBe('fr');
  });

  it('refuses to guess from a sample too short to be reliable', () => {
    expect(detectTrackLanguage([cue('Sí', '', 0)])).toBe('');
  });

  it('mismatch compares the track against the learning language', () => {
    expect(isLanguageMismatch('es', 'en')).toBe(true);
    expect(isLanguageMismatch('en-US', 'en')).toBe(false);
    expect(isLanguageMismatch('', 'en')).toBe(false);
    expect(isLanguageMismatch('es', '')).toBe(false);
  });
});

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

describe('LanguageMismatchNotice', () => {
  it('the Spanish copy names both languages and the platform', () => {
    const text = fill(ALL_MESSAGES.es['rail.langMismatch']!, {
      track: 'Español', learning: 'English', platform: 'Netflix',
    });
    expect(text).toContain('Español');
    expect(text).toContain('English');
    expect(text).toContain('Netflix');
    expect(text).toMatch(/estás aprendiendo/i);
  });

  it('the English copy names both languages and the platform', () => {
    const text = fill(ALL_MESSAGES.en['rail.langMismatch']!, {
      track: 'Español', learning: 'English', platform: 'Netflix',
    });
    expect(text).toContain('Español');
    expect(text).toContain('English');
    expect(text).toContain('Netflix');
    expect(text).toMatch(/you are learning/i);
  });

  it('renders with the endonyms of the two languages', () => {
    render(<LanguageMismatchNotice track="es" learning="en" platform="netflix" />);
    const node = screen.getByText(/subt|subtitle/i);
    expect(node.textContent).toContain('Español');
    expect(node.textContent).toContain('English');
  });
});
