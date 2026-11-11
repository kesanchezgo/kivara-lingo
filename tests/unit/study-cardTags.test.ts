import { describe, expect, it } from 'vitest';
import {
  PLATFORMS,
  cardTags,
  episodeCode,
  kindTag,
  langTag,
  originLabel,
  platformTag,
  reviveSource,
  slugTag,
  sourceLabel,
  sourceTag,
  tagsOf,
  TAG_ROOT,
} from '../../src/shared/study/cardTags';

describe('cardTags · slugTag', () => {
  it('lowercases and joins words with underscores', () => {
    expect(slugTag('Game of Thrones')).toBe('game_of_thrones');
  });

  it('strips only Latin accents, keeping other scripts', () => {
    expect(slugTag('Élite')).toBe('elite');
    expect(slugTag('進撃の巨人')).toBe('進撃の巨人');
  });

  it('returns an empty string for blank input', () => {
    expect(slugTag('   ')).toBe('');
  });
});

describe('cardTags · episodeCode', () => {
  it('pads a season and episode', () => {
    expect(episodeCode({ platform: 'netflix', season: 1, episode: 2 })).toBe('s01e02');
  });

  it('is undefined unless both are present', () => {
    expect(episodeCode({ platform: 'netflix', season: 1 })).toBeUndefined();
  });
});

describe('cardTags · sourceTag', () => {
  it('uses series and episode when both exist', () => {
    expect(sourceTag({ platform: 'netflix', series: 'Game of Thrones', season: 1, episode: 1 }))
      .toBe('kivara::game_of_thrones::s01e01');
  });

  it('falls back to the title for a movie', () => {
    expect(sourceTag({ platform: 'netflix', title: 'Inception' })).toBe('kivara::inception');
  });

  it('never builds a series tag from the platform name alone', () => {
    expect(sourceTag({ platform: 'youtube' })).toBeUndefined();
    expect(sourceTag({ platform: 'netflix', title: 'Netflix' })).toBeUndefined();
    expect(sourceTag({ platform: 'netflix', series: 'Netflix', season: 1, episode: 2 })).toBeUndefined();
  });

  it('keeps the explicit platform tag when the title is generic', () => {
    expect(cardTags('word', { platform: 'netflix', title: 'Netflix' })).toEqual([
      'kivara::platform::netflix',
      'kivara::word',
    ]);
  });
});

describe('cardTags · platformTag / kindTag / langTag', () => {
  it('uses the platform slug', () => {
    expect(platformTag('max')).toBe('kivara::platform::hbo_max');
  });

  it('builds the kind tag', () => {
    expect(kindTag('expression')).toBe('kivara::expression');
  });

  it('slugifies the language code', () => {
    expect(langTag('EN')).toBe('kivara::lang::en');
  });
});

describe('cardTags · cardTags / tagsOf', () => {
  it('orders language, platform, source and kind', () => {
    expect(cardTags('word', { platform: 'netflix', title: 'Inception' }, 'en')).toEqual([
      'kivara::lang::en',
      'kivara::platform::netflix',
      'kivara::inception',
      'kivara::word',
    ]);
  });

  it('emits only the kind tag without language or source', () => {
    expect(cardTags('word')).toEqual(['kivara::word']);
  });

  it('derives tags for old cards without any', () => {
    expect(tagsOf({ kind: 'word' })).toEqual(['kivara::word']);
  });

  it('leaves tags untouched when the language tag is already there', () => {
    const tags = ['kivara::lang::en', 'kivara::word'];
    expect(tagsOf({ kind: 'word', tags, lang: 'en' })).toBe(tags);
  });

  it('prepends a missing language tag', () => {
    expect(tagsOf({ kind: 'word', tags: ['kivara::word'], lang: 'en' })).toEqual(['kivara::lang::en', 'kivara::word']);
  });
});

describe('cardTags · sourceLabel / originLabel', () => {
  it('labels a series episode', () => {
    expect(sourceLabel({ platform: 'netflix', series: 'Game of Thrones', season: 1, episode: 1 }))
      .toBe('Game of Thrones · S1 E1');
  });

  it('labels a movie by its title', () => {
    expect(sourceLabel({ platform: 'netflix', title: 'Inception' })).toBe('Inception');
  });

  it('adds the platform name to the origin', () => {
    expect(originLabel({ platform: 'max', series: 'Game of Thrones', season: 1, episode: 2 }))
      .toBe('Game of Thrones · S1 E2 · HBO Max');
  });

  it('is undefined without a source', () => {
    expect(sourceLabel(undefined)).toBeUndefined();
    expect(originLabel(undefined)).toBeUndefined();
  });
});

describe('cardTags · reviveSource', () => {
  it('keeps well-formed fields', () => {
    expect(reviveSource({ platform: 'netflix', season: 1, episode: 2, title: 'X' }))
      .toEqual({ platform: 'netflix', series: undefined, season: 1, episode: 2, title: 'X' });
  });

  it('drops an unknown platform', () => {
    expect(reviveSource({ platform: 'bogus' })).toBeUndefined();
  });

  it('drops non-objects and non-finite numbers', () => {
    expect(reviveSource(null)).toBeUndefined();
    expect(reviveSource({ platform: 'netflix', season: Number.NaN })).toMatchObject({ season: undefined });
  });
});

describe('cardTags · PLATFORMS / TAG_ROOT', () => {
  it('maps max to the hbo_max slug', () => {
    expect(PLATFORMS.max).toEqual({ name: 'HBO Max', slug: 'hbo_max' });
    expect(TAG_ROOT).toBe('kivara');
  });
});
