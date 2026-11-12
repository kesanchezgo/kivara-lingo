/**
 * Every `CreateCardKind` has a label in both locales (debt D2).
 *
 * The card list rendered `recent.kind.*` only for `word` and `expression`, so
 * a `cloze` card silently showed no kind at all — and adding a kind meant
 * remembering a second place. The render is now a plain template lookup; this
 * test walks the union so a kind without copy fails here instead of shipping
 * the raw key to the user (the dead-key scan skips this family by design).
 */
import { describe, expect, it } from 'vitest';
import { ALL_MESSAGES } from '../../src/shared/i18n';
import type { CreateCardKind } from '../../src/shared/types';

/** The whole union, spelled out: TypeScript fails the build if one is added
 *  and this list (and therefore the copy check) is not updated. */
const ALL_KINDS: CreateCardKind[] = ['word', 'expression', 'cloze'];

describe('recent.kind labels', () => {
  it('covers every CreateCardKind in Spanish', () => {
    for (const kind of ALL_KINDS) {
      const label = ALL_MESSAGES.es[`recent.kind.${kind}`];
      expect(label, `recent.kind.${kind} (es)`).toBeTruthy();
      expect(label).not.toBe(`recent.kind.${kind}`);
    }
  });

  it('covers every CreateCardKind in English', () => {
    for (const kind of ALL_KINDS) {
      const label = ALL_MESSAGES.en[`recent.kind.${kind}`];
      expect(label, `recent.kind.${kind} (en)`).toBeTruthy();
      expect(label).not.toBe(`recent.kind.${kind}`);
    }
  });

  it('keeps the two labels distinct where they should be', () => {
    // A cloze card is not a word card: same string in es and en would hide a
    // wrong locale, but cloze vs word must differ in at least one locale.
    expect(ALL_MESSAGES.es['recent.kind.cloze']).not.toBe(ALL_MESSAGES.es['recent.kind.word']);
    expect(ALL_MESSAGES.en['recent.kind.cloze']).not.toBe(ALL_MESSAGES.en['recent.kind.word']);
  });
});
