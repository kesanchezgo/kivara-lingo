/**
 * Unit tests for the onboarding-step helpers that decide which curated
 * dictionary packs the wizard should download. The helpers are pure and
 * operate on a small in-memory catalogue, so the tests can be synchronous
 * and free of IndexedDB / fetch mocking.
 */
import { describe, expect, it } from 'vitest';
import {
  CURATED_DICT_PACKS,
  defaultSelection,
  pickPacksToInstall,
  type OnboardingDictPack,
} from '../../src/onboarding/dict-onboarding';

const FAKE_PACKS: OnboardingDictPack[] = [
  {
    url: 'https://cdn.example/pack-a.zip',
    title: 'Pack A',
    description: 'core pack',
    size: '≈1 MB',
    defaultSelected: true,
    tier: 'core',
    benefit: 'Core',
  },
  {
    url: 'https://cdn.example/pack-b.zip',
    title: 'Pack B',
    description: 'recommended pack',
    size: '≈5 MB',
    defaultSelected: true,
    tier: 'recommended',
    benefit: 'Recommended',
  },
  {
    url: 'https://cdn.example/pack-c.zip',
    title: 'Pack C',
    description: 'premium pack',
    size: '≈100 MB',
    defaultSelected: false,
    tier: 'premium',
    benefit: 'Premium',
  },
];

describe('CURATED_DICT_PACKS', () => {
  it('exposes the three EN-learning packs in priority order', () => {
    expect(CURATED_DICT_PACKS).toHaveLength(3);
    expect(CURATED_DICT_PACKS.map((p) => p.title)).toEqual([
      'Wiktionary EN→ES',
      'Wiktionary EN IPA',
      'Wiktionary EN→EN',
    ]);
  });

  it('defaults the two lightweight packs ON and the 127 MB monolingual OFF', () => {
    expect(CURATED_DICT_PACKS[0].defaultSelected).toBe(true);
    expect(CURATED_DICT_PACKS[1].defaultSelected).toBe(true);
    expect(CURATED_DICT_PACKS[2].defaultSelected).toBe(false);
  });

  it('uses unique pack ids (urls + titles)', () => {
    const urls = new Set(CURATED_DICT_PACKS.map((p) => p.url));
    const titles = new Set(CURATED_DICT_PACKS.map((p) => p.title));
    expect(urls.size).toBe(CURATED_DICT_PACKS.length);
    expect(titles.size).toBe(CURATED_DICT_PACKS.length);
  });
});

describe('defaultSelection', () => {
  it('pre-ticks every pack with defaultSelected=true on a fresh install', () => {
    const sel = defaultSelection(FAKE_PACKS, new Set());
    expect(Array.from(sel).sort()).toEqual([
      'https://cdn.example/pack-a.zip',
      'https://cdn.example/pack-b.zip',
    ]);
  });

  it('drops a default-selected pack when the user already has it installed', () => {
    const sel = defaultSelection(FAKE_PACKS, new Set(['Pack A']));
    expect(Array.from(sel)).toEqual(['https://cdn.example/pack-b.zip']);
  });

  it('returns an empty set when every default-selected pack is installed', () => {
    const sel = defaultSelection(FAKE_PACKS, new Set(['Pack A', 'Pack B']));
    expect(sel.size).toBe(0);
  });

  it('never auto-ticks the premium pack even if nothing is installed', () => {
    const sel = defaultSelection(FAKE_PACKS, new Set());
    expect(sel.has('https://cdn.example/pack-c.zip')).toBe(false);
  });
});

describe('pickPacksToInstall', () => {
  it('returns the selected packs that are not yet installed', () => {
    const result = pickPacksToInstall(
      FAKE_PACKS,
      new Set(['Pack B']),
      new Set(['https://cdn.example/pack-a.zip', 'https://cdn.example/pack-b.zip']),
    );
    expect(result.map((p) => p.title)).toEqual(['Pack A']);
  });

  it('preserves catalogue order so the install loop matches the UI order', () => {
    const result = pickPacksToInstall(
      FAKE_PACKS,
      new Set(),
      new Set([
        'https://cdn.example/pack-c.zip',
        'https://cdn.example/pack-a.zip',
        'https://cdn.example/pack-b.zip',
      ]),
    );
    expect(result.map((p) => p.title)).toEqual(['Pack A', 'Pack B', 'Pack C']);
  });

  it('drops urls that are not in the curated catalogue', () => {
    const result = pickPacksToInstall(
      FAKE_PACKS,
      new Set(),
      new Set([
        'https://cdn.example/pack-a.zip',
        'https://cdn.example/something-else.zip',
      ]),
    );
    expect(result.map((p) => p.title)).toEqual(['Pack A']);
  });

  it('returns an empty list when nothing is selected', () => {
    expect(pickPacksToInstall(FAKE_PACKS, new Set(), new Set())).toEqual([]);
  });

  it('returns an empty list when every selected pack is already installed', () => {
    const result = pickPacksToInstall(
      FAKE_PACKS,
      new Set(['Pack A', 'Pack B']),
      new Set(['https://cdn.example/pack-a.zip', 'https://cdn.example/pack-b.zip']),
    );
    expect(result).toEqual([]);
  });
});
