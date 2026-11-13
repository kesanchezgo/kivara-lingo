import { t } from './i18n/core';
/**
 * Curated catalogue of high-quality Wiktionary-derived packs published weekly
 * by the kaikki-to-yomitan project.
 *
 * Reference: https://github.com/themoeway/kaikki-to-yomitan
 *
 * Centralised here so DictPacksSection (full gallery) and the Onboarding
 * wizard (subset) can share metadata + URLs and stay in lock-step.
 */

const PACKS_BASE_URL =
  'https://pub-c3d38cca4dc2403b88934c56748f5144.r2.dev/releases/latest';

export interface RecommendedPack {
  /** Display title shown in the gallery card. */
  title: string;
  /** One-line description of what's inside. */
  description: string;
  /** ZIP download URL (Yomitan-format). */
  url: string;
  /** Approximate compressed size — surfaced so users know the cost. */
  size: string;
  /**
   * Coverage / impact tier — colours the card border for quick scanning.
   *  - `core`        → imprescindible (amber ribbon, Sparkles icon).
   *  - `recommended` → daily-driver (indigo ribbon).
   *  - `premium`    → opt-in advanced (zinc ribbon).
   */
  tier: 'recommended' | 'core' | 'premium';
  /** Group label used to bucket cards into UI sections. */
  group: 'bilingual' | 'monolingual' | 'phonetic' | 'frequency' | 'examples';
  /** ISO-ish language pair label ("EN → ES", "EN IPA", …). */
  langs: string;
  /** License / source attribution, surfaced as small caption text. */
  license: string;
}

export const RECOMMENDED_PACKS: RecommendedPack[] = [
  // Only packs whose ZIP we've verified exists at the CDN (HEAD 200).
  // Variants without a published artifact (US/UK/AusE IPA, Tatoeba, freq)
  // are tracked in the README backlog and will be added when published.
  // Sizes are real HTTP `Content-Length` rounded — not estimates.
  // ── Bilingüe (traducción) ──────────────────────────────────────────────
  {
    title: 'Wiktionary EN→ES',
    description: t('dictpack.enEsDesc'),
    url: `${PACKS_BASE_URL}/kty-en-es.zip`,
    size: '≈1.5 MB',
    tier: 'core',
    group: 'bilingual',
    langs: 'EN → ES',
    license: 'CC-BY-SA · Wiktionary',
  },
  {
    title: 'Wiktionary ES→EN',
    description: t('dictpack.esEnDesc'),
    url: `${PACKS_BASE_URL}/kty-es-en.zip`,
    size: '≈22 MB',
    tier: 'recommended',
    group: 'bilingual',
    langs: 'ES → EN',
    license: 'CC-BY-SA · Wiktionary',
  },
  // ── Monolingüe (inmersión) ─────────────────────────────────────────────
  {
    title: 'Wiktionary EN→EN',
    description: t('dictpack.enEnDesc'),
    url: `${PACKS_BASE_URL}/kty-en-en.zip`,
    size: '≈127 MB',
    tier: 'premium',
    group: 'monolingual',
    langs: 'EN → EN',
    license: 'CC-BY-SA · Wiktionary',
  },
  {
    title: 'Wiktionary ES→ES',
    description: t('dictpack.esEsDesc'),
    url: `${PACKS_BASE_URL}/kty-es-es.zip`,
    size: '≈38 MB',
    tier: 'recommended',
    group: 'monolingual',
    langs: 'ES → ES',
    license: 'CC-BY-SA · Wiktionary',
  },
  // ── IPA (pronunciación) ────────────────────────────────────────────────
  {
    title: 'Wiktionary EN IPA',
    description: t('dictpack.enIpaDesc'),
    url: `${PACKS_BASE_URL}/kty-en-ipa.zip`,
    size: '≈5 MB',
    tier: 'recommended',
    group: 'phonetic',
    langs: 'EN IPA',
    license: 'CC-BY-SA · Wiktionary',
  },
];

/**
 * Group label keys, resolved at RENDER time with `t(labelKey)` by the
 * consumer (DictPacksSection): the catalogue module is imported before the
 * locale can matter, and resolving here froze one locale for every surface.
 * `phonetic` carries its own key — it no longer borrows another group's copy.
 */
export const GROUP_LABELS: Record<RecommendedPack['group'], string> = {
  bilingual:   'dictpack.groupBilingual',
  monolingual: 'dictpack.groupMonolingual',
  phonetic:    'dictpack.groupPhonetic',
  frequency:   'dictpack.groupFrequency',
  examples:    'dictpack.groupExamples',
};
