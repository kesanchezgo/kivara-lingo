/**
 * Point 5 — the real title, not a piece of Netflix's interface.
 *
 * The QA card came out with `source.title = "Así aprenderás"` and the Anki tag
 * `kivara::asi_aprenderas`: `readNetflixMedia` trusted the first DOM selector
 * that answered, and on the QA build that was UI copy. Netflix's OWN title is
 * in `document.title` ("<Título> | Netflix"), so that is the source of truth;
 * a DOM candidate is only accepted when it agrees with it.
 */
import { describe, expect, it } from 'vitest';
import {
  netflixTitleFrom,
  officialTitleFrom,
} from '../../src/content/platform-adapters/netflix';

describe('official title from document.title', () => {
  it('strips the " | Netflix" suffix and the "- Netflix" variant', () => {
    expect(officialTitleFrom('Amor eterno | Netflix')).toBe('Amor eterno');
    expect(officialTitleFrom('Amor eterno: Temporada 1 - Netflix')).toBe('Amor eterno: Temporada 1');
  });

  it('answers nothing when the document title is the bare brand', () => {
    expect(officialTitleFrom('Netflix')).toBe('');
    expect(officialTitleFrom('')).toBe('');
  });
});

describe('netflixTitleFrom', () => {
  const DOC = 'Amor eterno | Netflix';

  it('drops a DOM candidate that is interface copy', () => {
    // The exact QA failure: the DOM said "Así aprenderás" while the document
    // title said the show's name.
    const out = netflixTitleFrom(DOC, { title: 'Así aprenderás', series: undefined });
    expect(out.title).toBe('Amor eterno');
  });

  it('keeps a DOM candidate that agrees with the document title', () => {
    const out = netflixTitleFrom(DOC, { title: 'Amor eterno', series: 'Amor eterno' });
    expect(out.title).toBe('Amor eterno');
    expect(out.series).toBe('Amor eterno');
  });

  it('accepts a series/episode split that agrees with the document title', () => {
    const out = netflixTitleFrom('Amor eterno: Temporada 1 | Netflix', {
      title: 'Amor eterno: Temporada 1',
      series: 'Amor eterno',
    });
    expect(out.title).toBe('Amor eterno: Temporada 1');
    expect(out.series).toBe('Amor eterno');
  });

  it('drops a series candidate that is not part of the document title', () => {
    const out = netflixTitleFrom(DOC, { title: 'Amor eterno', series: 'Así aprenderás' });
    expect(out.series).toBeUndefined();
  });

  it('falls back to the candidate only when the document title says nothing', () => {
    const out = netflixTitleFrom('Netflix', { title: 'Amor eterno', series: undefined });
    expect(out.title).toBe('Amor eterno');
  });

  it('prefers the MAIN-world media title when it agrees', () => {
    const out = netflixTitleFrom(DOC, { title: 'Así aprenderás', series: undefined }, { videoId: '82939619', title: 'Amor eterno' });
    expect(out.title).toBe('Amor eterno');
  });

  it('ignores a MAIN-world title that disagrees with the document title', () => {
    const out = netflixTitleFrom(DOC, { title: '', series: undefined }, { videoId: '1', title: 'Some Other Show' });
    expect(out.title).toBe('Amor eterno');
  });
});
