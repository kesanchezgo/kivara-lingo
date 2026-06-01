/// <reference types="chrome" />

/**
 * Phased word resolution for the hover popover.
 *
 * Emits results in priority order so the popover paints the essential
 * fields (translation / definition / IPA) almost immediately and fills
 * in the slower extras (synonyms / antonyms / collocations / examples /
 * etymology / VIP) as they arrive, without blocking on the slowest
 * source.
 *
 * Phases (each calls `emit` as soon as it's ready):
 *   1. local       — bundled + Yomitan dictionary hit (sync-ish, + IPA augment)
 *   2. translation — remote translator, only when local had no real one
 *   3. enrichment  — the fully-merged multi-source entry
 *   4. ai          — optional AI enrichment
 *   5. done        — terminal
 *
 * The same function backs BOTH the streaming port transport (real
 * progressive UX) and the legacy one-shot `RESOLVE_WORD` message (it
 * just collects every emit into a waves[] array). This keeps a single
 * source of truth for the resolution logic so quality never diverges
 * between the two paths.
 */

import type {
  DictionaryEntry,
  ResolveWordStreamMsg,
} from '../shared/types';
import { translateText } from './translate';
import { enrichWithAi, getAiSettings, getResolvedNativeLang } from './ai-enrich';
import { getVipSettings, loadTranslateTargetLang } from './vip-settings';
import { runEnrichment } from './enrichment/orchestrator';
import { getMissingPhonetic } from './phonetic-augment';
import { lookupDictionary } from '../content/nlp/dictionary';
import { lookupYomitanTerm } from '../content/nlp/yomitan';
import {
  BUNDLE_PACK_ID,
  MISS_PACK_ID,
  REMOTE_PACK_ID,
  recordLookupHit,
  recordMiss,
} from '../shared/telemetry';

export interface ResolveWordParams {
  token: string;
  sentence: string;
  sourceLang: string;
  includeAi: boolean;
}

type Emit = (msg: ResolveWordStreamMsg) => void;

function hasRealTranslation(entry: DictionaryEntry | null | undefined): boolean {
  const t = (entry?.translation ?? '').trim();
  return t !== '' && t !== '—';
}

/**
 * Run the phased resolution, calling `emit` for each phase. Resolves
 * once the terminal `done` phase has been emitted. Never throws — every
 * failure is funnelled into an `error` phase so the popover degrades
 * gracefully.
 */
export async function resolveWordStreaming(
  params: ResolveWordParams,
  emit: Emit,
): Promise<void> {
  const sourceLang = params.sourceLang || 'en';
  const token = (params.token ?? '').trim();
  const sentence = params.sentence ?? '';

  if (!token) {
    emit({ phase: 'local', entry: null });
    emit({ phase: 'done' });
    return;
  }

  /* ── Phase 1: local dictionary (Yomitan packs → bundled) ──────────── */
  let local: DictionaryEntry | null = null;
  let resolvedPackId: string | null = null;
  let yomitanPackTitle: string | null = null;
  try {
    const hit = await lookupYomitanTerm(token, sourceLang);
    if (hit) {
      local = hit.entry;
      yomitanPackTitle = hit.pack.title;
      resolvedPackId = hit.pack.id;
    }
  } catch (err) {
    console.warn('[Kivara Lingo] yomitan lookup failed', err);
  }

  if (!local) {
    const bundleHit = lookupDictionary(token, sourceLang);
    if (bundleHit) {
      local = bundleHit;
      resolvedPackId = BUNDLE_PACK_ID;
    }
  } else {
    const bundleHit = lookupDictionary(token, sourceLang);
    if (bundleHit) {
      const merged: DictionaryEntry = { ...local };
      if (!merged.level && bundleHit.level) merged.level = bundleHit.level;
      if (!merged.phonetic && bundleHit.phonetic) merged.phonetic = bundleHit.phonetic;
      if ((!merged.examples || merged.examples.length === 0) && bundleHit.examples) {
        merged.examples = bundleHit.examples;
      }
      local = merged;
    }
  }

  // IPA augment (cheap + cached). Only when we already have a local hit.
  if (local && !local.phonetic) {
    try {
      const augmented = await getMissingPhonetic(token, sourceLang);
      if (augmented) local = { ...local, phonetic: augmented };
    } catch {
      /* best-effort */
    }
  }

  // Emit the local entry immediately — this paints the header + (for known
  // words) the translation/definition/IPA essential fold.
  emit({ phase: 'local', entry: local });
  // Synthetic provider attribution when a Yomitan pack covered the word.
  if (local && yomitanPackTitle && hasRealTranslation(local)) {
    emit({
      phase: 'translation',
      entry: local,
      provider: `pack:${yomitanPackTitle}`,
      cached: false,
    });
  }

  /* ── Phases 2-4 run CONCURRENTLY ──────────────────────────────────
   * Translation, multi-source enrichment and (optional) AI are mutually
   * independent — none consumes another's output — so we launch them
   * together and merge + emit each result the moment it lands, instead
   * of summing their latencies. Total wall-clock becomes max(t2,t3,t4)
   * rather than t2+t3+t4. Quality is unchanged: the same sources run
   * with the same merge precedence; only the *ordering* of the awaits
   * changes.
   *
   * Shared state: `local` is the running merged entry. JS is
   * single-threaded, so each `.then` callback runs atomically between
   * await points — there's no true data race. Each phase only writes
   * its own disjoint fields (translation→translation/bilingual,
   * enrichment→synonyms/antonyms/etc., AI→vip.mnemonic/etymology) and
   * never downgrades a value another phase set.
   */
  const needsRemoteTranslation = !hasRealTranslation(local) && !yomitanPackTitle;
  let remoteServed = false;

  // Phase 2 — remote translator.
  const translationTask = (async () => {
    if (!needsRemoteTranslation) return;
    try {
      const remote = await translateText({ text: token, sourceLang });
      if (remote.ok && remote.translatedText) {
        remoteServed = true;
        if (local) {
          local = {
            ...local,
            translation: hasRealTranslation(local) ? local.translation : remote.translatedText,
            bilingual:
              local.bilingual && local.bilingual !== '—'
                ? local.bilingual
                : remote.translatedText,
          };
        } else {
          local = {
            token,
            type: token.includes(' ') ? 'phrase' : 'word',
            translation: remote.translatedText,
            bilingual: remote.translatedText,
          };
        }
        emit({
          phase: 'translation',
          entry: local,
          provider: remote.provider ?? 'offline',
          cached: remote.cached ?? false,
        });
      } else if (!remote.ok) {
        emit({ phase: 'error', scope: 'remote', message: remote.error ?? 'translate failed' });
      }
    } catch (err) {
      emit({
        phase: 'error',
        scope: 'remote',
        message: err instanceof Error ? err.message : 'translate threw',
      });
    }
  })();

  // Phase 3 — multi-source enrichment (the slower extras).
  const enrichmentTask = (async () => {
    try {
      const vipSettings = await getVipSettings();
      const targetLang = (await loadTranslateTargetLang()) || sourceLang;
      const result = await runEnrichment(token, {
        sourceLang,
        targetLang,
        sentence,
        vip: vipSettings,
        purpose: 'popover',
      });
      if (result.entry) {
        const localTr = (local?.translation ?? '').trim();
        const localTrReal = localTr !== '' && localTr !== '—';
        const chainTr = (result.entry.translation ?? '').trim();
        const chainTrReal = chainTr !== '' && chainTr !== '—';
        // Prefer, in order: Yomitan-pack translation → an already-resolved
        // real local/remote translation → the enrichment chain's → the
        // chain's as last resort. This never downgrades a translation the
        // (possibly concurrent) translation phase already set.
        const bestTranslation =
          localTrReal && resolvedPackId && resolvedPackId !== BUNDLE_PACK_ID
            ? local!.translation
            : localTrReal
              ? local!.translation
              : chainTrReal
                ? result.entry.translation
                : result.entry.translation;
        const merged: DictionaryEntry = {
          ...(local ?? result.entry),
          translation: bestTranslation,
          bilingual:
            (local?.bilingual && local.bilingual !== '—' ? local.bilingual : undefined) ??
            (result.entry.bilingual && result.entry.bilingual !== '—'
              ? result.entry.bilingual
              : undefined) ??
            local?.bilingual ??
            result.entry.bilingual,
          synonyms: result.entry.synonyms ?? local?.synonyms,
          antonyms: result.entry.antonyms ?? local?.antonyms,
          collocations: result.entry.collocations ?? local?.collocations,
          audio: result.entry.audio ?? local?.audio,
          // Merge vip blocks rather than overwrite, so a concurrent AI
          // phase's mnemonic/etymology survives regardless of order.
          vip: { ...(result.entry.vip ?? {}), ...(local?.vip ?? {}) },
          phonetic: local?.phonetic ?? result.entry.phonetic,
          monolingual:
            (local?.monolingual && local.monolingual !== '—' ? local.monolingual : undefined) ??
            result.entry.monolingual ??
            local?.monolingual,
          examples: (local?.examples?.length ?? 0) > 0 ? local!.examples : result.entry.examples,
        };
        local = merged;
        emit({ phase: 'enrichment', entry: merged });
      }
    } catch (err) {
      console.warn('[Kivara Lingo] enrichment chain threw', err);
      emit({
        phase: 'error',
        scope: 'enrichment',
        message: err instanceof Error ? err.message : 'enrichment threw',
      });
    }
  })();

  // Phase 4 — AI enrichment (optional).
  const aiTask = (async () => {
    if (!params.includeAi) return;
    const settings = await getAiSettings();
    if (settings.provider === 'disabled' || !settings.apiKey || !settings.enrichOnHover) return;
    const nativeLang = await getResolvedNativeLang(settings);
    try {
      const ai = await enrichWithAi({ token, sentence, sourceLang, nativeLang });
      if (ai.ok) {
        if (local) {
          const newVip = { ...(local.vip ?? {}) };
          if (ai.data.mnemonic && !newVip.mnemonic) newVip.mnemonic = ai.data.mnemonic;
          if (ai.data.etymology && !newVip.etymology) newVip.etymology = ai.data.etymology;
          local = { ...local, vip: newVip };
          emit({ phase: 'enrichment', entry: local });
        }
        emit({ phase: 'ai', data: ai.data });
      } else {
        emit({ phase: 'error', scope: 'ai', message: ai.error });
      }
    } catch (err) {
      emit({
        phase: 'error',
        scope: 'ai',
        message: err instanceof Error ? err.message : 'AI threw',
      });
    }
  })();

  // Wait for all three independent phases to settle.
  await Promise.allSettled([translationTask, enrichmentTask, aiTask]);

  // Telemetry — exactly one bucket per resolve, after we know the outcome.
  void (async () => {
    if (resolvedPackId) await recordLookupHit(resolvedPackId);
    else if (remoteServed) await recordLookupHit(REMOTE_PACK_ID);
    else await recordMiss(MISS_PACK_ID);
  })();

  emit({ phase: 'done' });
}
