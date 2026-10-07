/**
 * Curated dictionary catalogue surfaced in the onboarding wizard.
 *
 * The full catalogue (with all variants) lives in `DictPacksSection.tsx`.
 * Onboarding intentionally narrows it down to the three highest-leverage
 * packs for an ES-native learner of EN, so a fresh install ends with a
 * solid offline coverage without overwhelming the user with choice.
 *
 *  1. Wiktionary EN→ES   — default ON. Bilingual translations + examples.
 *                          Without this, every hover falls through to the
 *                          remote translator chain. ~61k terms (~51k unique
 *                          headwords), verified 2026-10-07 from the shipped ZIP.
 *  2. Wiktionary EN IPA  — default ON. Fills the `phonetic` field on
 *                          ~95% of cards (the bundled dictionary only
 *                          covers ~10%). ~140k meta rows (~138k unique
 *                          expressions), verified 2026-10-07.
 *  3. Wiktionary EN→EN   — default OFF. Monolingual definitions for B2+
 *                          immersion. 127 MB so we never opt people in
 *                          automatically.
 *
 * URLs match the canonical entries in `DictPacksSection.RECOMMENDED_PACKS`
 * so the auto-check / installed-detection logic stays consistent.
 */

const PACKS_BASE_URL = 'https://pub-c3d38cca4dc2403b88934c56748f5144.r2.dev/releases/latest';

export interface OnboardingDictPack {
  /** Stable handle used by the UI selection set + by the install loop. */
  url: string;
  /** Matches `DictPackRow.title` exactly so already-installed detection works. */
  title: string;
  /** Short pitch shown under the title in the onboarding card. */
  description: string;
  /** Pretty label like "≈1.5 MB" — matches the gallery copy. */
  size: string;
  /** Whether the wizard should pre-tick this pack on first render. */
  defaultSelected: boolean;
  /** Tier badge — `core` is the imprescindible row, `premium` is opt-in. */
  tier: 'core' | 'recommended' | 'premium';
  /** One-line benefit copy, surfaced as a small badge under the title. */
  benefit: string;
  /**
   * When true, the pack is shown in onboarding for informational purposes
   * but cannot be installed from there (too large, requires streaming, etc.).
   * The user is directed to Settings → Diccionarios offline instead.
   */
  disabledInOnboarding?: boolean;
  /** Reason shown when the pack is disabled in onboarding. */
  disabledReason?: string;
}

export const CURATED_DICT_PACKS: OnboardingDictPack[] = [
  {
    url: `${PACKS_BASE_URL}/kty-en-es.zip`,
    title: 'Wiktionary EN→ES',
    description: 'Traducciones al español, ejemplos y categoría gramatical para ~61 000 términos.',
    size: '≈1.5 MB',
    defaultSelected: true,
    tier: 'core',
    benefit: 'Imprescindible',
  },
  {
    url: `${PACKS_BASE_URL}/kty-en-ipa.zip`,
    title: 'Wiktionary EN IPA',
    description: 'Transcripción fonética IPA real para ~140 000 entradas.',
    size: '≈5 MB',
    defaultSelected: true,
    tier: 'recommended',
    benefit: 'Pronunciación',
  },
  {
    url: `${PACKS_BASE_URL}/kty-en-en.zip`,
    title: 'Wiktionary EN→EN',
    description: 'Definiciones monolingües en inglés. Recomendado para nivel B2+.',
    size: '≈127 MB',
    defaultSelected: false,
    tier: 'premium',
    benefit: 'Inmersión avanzada',
    disabledInOnboarding: true,
    disabledReason: 'Muy grande para instalar aquí (127 MB). Instálalo desde Settings → Diccionarios offline.',
  },
];

/**
 * Pick which curated packs to actually install.
 *
 * Filters by:
 *   - membership in the user's selection set (keyed by url)
 *   - exclusion of packs whose title is already installed (re-imports are
 *     idempotent at the data layer but we skip them so the user doesn't
 *     waste 30s redownloading a pack they already have)
 *
 * Pure — easy to test without IndexedDB or React.
 */
export function pickPacksToInstall(
  curated: OnboardingDictPack[],
  installedTitles: ReadonlySet<string>,
  selection: ReadonlySet<string>,
): OnboardingDictPack[] {
  return curated.filter(
    (p) =>
      selection.has(p.url) &&
      !installedTitles.has(p.title) &&
      !p.disabledInOnboarding,
  );
}

/**
 * Build the initial selection set the wizard renders with.
 *
 * Rules:
 *   - Start from each pack's `defaultSelected` flag.
 *   - Drop packs already installed — there's nothing to do for them and
 *     un-checking the box visually is the right signal.
 */
export function defaultSelection(
  curated: OnboardingDictPack[],
  installedTitles: ReadonlySet<string>,
): Set<string> {
  const sel = new Set<string>();
  for (const p of curated) {
    if (p.defaultSelected && !installedTitles.has(p.title)) sel.add(p.url);
  }
  return sel;
}
