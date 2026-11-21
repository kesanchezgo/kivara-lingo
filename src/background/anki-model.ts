/**
 * ANKI_ENSURE_MODEL's engine: install the KivaraLingo note model when it is
 * missing, idempotently. Both the service worker handler and the save-path
 * rescue (a `model was not found` failure during addNote) call THIS function
 * — one definition, no diverging copies.
 */
import { ankiConnect } from './anki-connect';
import { buildKivaraModel, KIVARA_MODEL_NAME } from '../shared/anki-model';

export interface EnsureModelResponse {
  ok: boolean;
  /** True when this call actually installed the model. */
  created?: boolean;
  error?: string;
}

export async function ensureKivaraModel(url?: string, apiKey?: string): Promise<EnsureModelResponse> {
  try {
    const names = await ankiConnect.modelNames(url, apiKey);
    if (names.includes(KIVARA_MODEL_NAME)) return { ok: true, created: false };
    await ankiConnect.createModel(buildKivaraModel(), url, apiKey);
    return { ok: true, created: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
