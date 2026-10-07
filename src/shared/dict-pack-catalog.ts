/**
 * Curated catalogue of high-quality Wiktionary-derived packs published weekly
 * by the kaikki-to-yomitan project.
 *
 * Reference: https://github.com/themoeway/kaikki-to-yomitan
 *
 * Centralised here so DictPacksSection (full gallery) and the Onboarding
 * wizard (subset) can share metadata + URLs and stay in lock-step.
 */

export const PACKS_BASE_URL =
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
    description: 'Diccionario bilingüe inglés→español derivado de Wiktionary.',
    url: `${PACKS_BASE_URL}/kty-en-es.zip`,
    size: '≈1.5 MB',
    tier: 'core',
    group: 'bilingual',
    langs: 'EN → ES',
    license: 'CC-BY-SA · Wiktionary',
  },
  {
    title: 'Wiktionary ES→EN',
    description: 'Bilingüe inverso para usuarios que quieren mirar palabras en español.',
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
    description: 'Definiciones monolingües en inglés (B2+). Útil para inmersión.',
    url: `${PACKS_BASE_URL}/kty-en-en.zip`,
    size: '≈127 MB',
    tier: 'premium',
    group: 'monolingual',
    langs: 'EN → EN',
    license: 'CC-BY-SA · Wiktionary',
  },
  {
    title: 'Wiktionary ES→ES',
    description: 'Definiciones monolingües en español (RAE-style).',
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
    description: 'Transcripción fonética IPA real para ~140 000 entradas inglesas.',
    url: `${PACKS_BASE_URL}/kty-en-ipa.zip`,
    size: '≈5 MB',
    tier: 'recommended',
    group: 'phonetic',
    langs: 'EN IPA',
    license: 'CC-BY-SA · Wiktionary',
  },
];

export const GROUP_LABELS: Record<RecommendedPack['group'], string> = {
  bilingual:   'Bilingüe',
  monolingual: 'Monolingüe',
  phonetic:    'Fonética / IPA',
  frequency:   'Frecuencia y nivel',
  examples:    'Oraciones de ejemplo',
};
