/**
 * Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged.
 *
 * Pure constants and guards only: the prototype's React hooks
 * (`useTranslationMode`, `useListenFirst`) are deliberately not ported here —
 * the redesign moves that state into the store slice (no React, no
 * localStorage in shared/study).
 */

/* ── Translation ────────────────────────────────────────────────────────── */

/**
 * The translation to your language, under the video subtitle and under each
 * transcript sentence: visible, blurred (read on hover; in the transcript also
 * when reached with Tab) or hidden. This used to be two settings that did not
 * talk to each other: «Bilingual subtitle» (video) and the transcript eye;
 * hiding the translation in one left it visible in the other.
 */
export type TranslationMode = 'visible' | 'blur' | 'hidden';
export const TRANSLATION_MODES: readonly TranslationMode[] = ['visible', 'blur', 'hidden'];
export const TRANSLATION_KEY = 'kvl:translation';
/** Cycle of the transcript eye. */
export const NEXT_TRANSLATION: Record<TranslationMode, TranslationMode> = { visible: 'blur', blur: 'hidden', hidden: 'visible' };
export const isTranslationMode = (v: unknown): v is TranslationMode => v === 'visible' || v === 'blur' || v === 'hidden';

/* ── Listen first ───────────────────────────────────────────────────────── */

/**
 * Listening-comprehension practice: while the video plays, the subtitle (and
 * the current sentence and the following ones in the transcript) blur; they
 * reveal on pause — also with the pause at the end of each sentence — or on
 * hover.
 */
export const LISTEN_FIRST_KEY = 'kvl:listenFirst';
