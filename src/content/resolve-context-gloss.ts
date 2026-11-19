/**
 * One contextual-gloss resolution for EVERY save path (popover, shortcut,
 * selection, panel). Uses the same one-shot RESOLVE_WORD bridge call the
 * popover's own fallback uses, so the gloss matches what the user saw; the
 * synchronous dictionary is the offline fallback. No new dependencies.
 *
 * The bridge call is bounded (~500 ms): a hung resolver must never stall the
 * save — the bundled dictionary gloss (or none) is good enough for tagging.
 */
import { sendMessage } from 'webext-bridge/content-script';
import type { ResolveWordResponse } from '../shared/types';
import { lookupDictionary } from './nlp/dictionary';

/** Max wait for the resolver before falling back to the dictionary. */
const RESOLVE_TIMEOUT_MS = 500;

export interface ResolvedContextGloss {
  /** A real gloss for this token in this sentence, or undefined. */
  gloss?: string;
  /** Part of speech when a resolver supplies one (none do today). */
  pos?: string;
}

function real(value: string | undefined | null): string | undefined {
  const v = String(value ?? '').trim();
  return v && v !== '—' ? v : undefined;
}

/** Resolve the meaning of `token` in `sentence` for the save request. */
export async function resolveContextGloss(
  token: string,
  sentence: string,
  lang: string,
): Promise<ResolvedContextGloss> {
  let fromResolver: string | undefined;
  try {
    // .catch keeps a late rejection from the losing race arm unhandled.
    const response = await Promise.race([
      sendMessage('RESOLVE_WORD', { token, sentence, sourceLang: lang }, 'background')
        .catch(() => undefined) as Promise<ResolveWordResponse | undefined>,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), RESOLVE_TIMEOUT_MS)),
    ]);
    const local = response?.waves?.find((w) => w.stage === 'local');
    if (local?.stage === 'local') fromResolver = real(local.entry?.translation);
  } catch {
    // Anki/AI offline: the dictionary fallback below still applies.
  }
  const gloss = fromResolver ?? real(lookupDictionary(token, lang)?.translation);
  return gloss ? { gloss } : {};
}
