/**
 * Shared types for the Standard + VIP enrichment chain.
 *
 * Every source is a self-contained module that exposes a single
 * `enrich(token, ctx)` function. Sources fail independently — a
 * Cambridge timeout never breaks Reverso. The orchestrator collects
 * every partial result and merges them into the final
 * `EnrichmentResult` returned to the popover / Anki flow.
 *
 * Design choices, all on purpose:
 *
 *  1. Every source has an `id` matching its `VipSettings` flag, so the
 *     orchestrator can early-exit when the user disabled it.
 *  2. The fetcher is injected — sources run inside the service worker
 *     and use `fetchWithTimeout` to honour `vip.perSourceTimeoutMs`.
 *  3. Partial results carry attribution (`source`) so the UI can render
 *     "Cambridge", "Longman" badges next to definitions.
 */

import type { DictionaryEntry, VipEnrichment } from '../../shared/types';

export interface EnrichmentContext {
  /** Source language (BCP-47 primary subtag — `en`, `es`, …). */
  sourceLang: string;
  /** Native (target) language. */
  targetLang: string;
  /** Optional sentence the token appears in. Used by sources that
   *  benefit from disambiguating polysemous words (Reverso, AI). */
  sentence?: string;
  /** Per-source timeout in ms (passed to fetchWithTimeout). */
  timeoutMs: number;
  /**
   * Optional AbortSignal so the orchestrator can cancel the whole
   * fan-out (e.g. user moved the cursor to a different word before
   * any wave finished).
   */
  signal?: AbortSignal;
}

/**
 * Partial enrichment result produced by a single source. The fields
 * are intentionally narrow: we only carry the data this source can
 * realistically provide so the merger doesn't have to second-guess.
 */
export interface SourcePartial {
  /** Definition strings produced by this source. */
  definitions?: string[];
  /** Bilingual translations (target language). */
  translations?: string[];
  /** Source-language sentence-level examples. */
  examples?: Array<{ text: string; translation?: string }>;
  /** Lemma-level synonyms in the source language. */
  synonyms?: string[];
  /** Lemma-level antonyms in the source language. */
  antonyms?: string[];
  /** Multi-word collocations (e.g. "make decision", "big deal"). */
  collocations?: string[];
  /** Phonetic transcription in IPA. */
  phonetic?: string;
  /** Audio URLs for the headword. */
  audio?: Array<{ url: string; accent?: string }>;
  /** Image URL hero candidate. */
  imageUrl?: string;
  /** Etymology paragraph. */
  etymology?: string;
  /** Mnemonic (AI-only). */
  mnemonic?: string;
  /** YouGlish-style real-world video pronunciations. */
  videoLinks?: Array<{ url: string }>;
  /** Frequency rank in BNC/COCA when the source ships it. */
  frequencyRank?: number;
}

/**
 * Returned by the orchestrator. Combines the local dictionary entry
 * with every successful partial. Sources that failed silently leave
 * `null`/empty fields untouched — the popover degrades gracefully.
 */
export interface EnrichmentResult {
  /** Local dictionary entry — always populated by the local layer. */
  entry: DictionaryEntry | null;
  /** Per-source breakdown for attribution & telemetry. */
  vip: VipEnrichment;
  /** Sources that responded successfully (used for badge render). */
  successfulSources: string[];
  /** Sources that errored — surfaced in the popover footer for the
   *  user so they can flip them off if the noise is unbearable. */
  failedSources: Array<{ source: string; error: string }>;
}

/**
 * Source contract. Every module under `enrichment/sources/` must default-
 * export an object matching this interface.
 */
export interface EnrichmentSource {
  /** Stable identifier — also the key in `VipSettings`. */
  id: string;
  /** Human-readable label rendered as a badge in the popover. */
  label: string;
  /**
   * The actual enrichment call. Must NEVER throw — return `{}` on any
   * failure so the orchestrator's fan-out stays resilient.
   */
  enrich(token: string, ctx: EnrichmentContext): Promise<SourcePartial>;
}
