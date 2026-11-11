/**
 * DictStep's essential-dictionary block — the core pack carries the
 * `onb.essential` badge instead of a hardcoded Spanish literal, and the three
 * rows use the prototype's `dictob.*` copy in the active locale.
 */
import { describe, expect, it } from 'vitest';
import { t } from '../../src/shared/i18n';
import { CURATED_DICT_PACKS } from '../../src/onboarding/dict-onboarding';

describe('DictStep essential dictionary block', () => {
  it('tags the core pack with the translated onb.essential badge', () => {
    expect(CURATED_DICT_PACKS[0]!.benefit).toBe(t('onb.essential'));
    expect(CURATED_DICT_PACKS[0]!.benefit).toBe('Imprescindible');
  });

  it('renders the prototype dictob copy for the IPA and monolingual packs', () => {
    expect(CURATED_DICT_PACKS[1]!.benefit).toBe(t('dictob.enIpaBenefit'));
    expect(CURATED_DICT_PACKS[1]!.benefit).toBe('Pronunciación');
    expect(CURATED_DICT_PACKS[2]!.benefit).toBe(t('dictob.enEnBenefit'));
    expect(CURATED_DICT_PACKS[2]!.benefit).toBe('Inmersión avanzada');
    expect(CURATED_DICT_PACKS[2]!.disabledReason).toBe(t('dictob.enEnDisabled'));
    expect(CURATED_DICT_PACKS[2]!.disabledReason).toContain('Diccionarios sin conexión');
  });
});
