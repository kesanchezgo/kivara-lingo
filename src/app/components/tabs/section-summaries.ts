/**
 * Accordion summary strings that need real plural / counting logic.
 *
 * Kept out of SettingsTab so the copy can be unit-tested without mounting the
 * whole panel: the dictionary group shows "1 active" / "N active" from the
 * count of enabled packs and must never fall back to naming the pack format
 * (the old literal was "yomitan").
 */
import { t } from '../../../shared/i18n';

/** Enabled dictionary packs: singular at 1, `{n}` plural otherwise. */
export function packsSummary(n: number): string {
  return n === 1 ? t('set.summaryPacksOne') : t('set.summaryPacks', { n });
}
