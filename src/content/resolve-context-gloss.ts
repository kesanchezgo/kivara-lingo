/**
 * One contextual-gloss resolution for EVERY save path (popover, shortcut,
 * selection, panel). Uses the same one-shot RESOLVE_WORD bridge call the
 * popover's own fallback uses, so the gloss matches what the user saw; the
 * synchronous dictionary is the offline fallback. No new dependencies.
 */
import { sendMessage } from 'webext-bridge/content-script';
import type { ResolveWordResponse } from '../shared/types';
import { lookupDictionary } from './nlp/dictionary';

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
    const response = (await sendMessage(
      'RESOLVE_WORD',
      { token, sentence, sourceLang: lang },
      'background',
    )) as ResolveWordResponse;
    const local = response?.waves?.find((w) => w.stage === 'local');
    if (local?.stage === 'local') fromResolver = real(local.entry?.translation);
  } catch {
    // Anki/AI offline: the dictionary fallback below still applies.
  }
  const gloss = fromResolver ?? real(lookupDictionary(token, lang)?.translation);
  return gloss ? { gloss } : {};
}
