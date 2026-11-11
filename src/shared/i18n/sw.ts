/**
 * i18n sw — strings the service worker emits that no UI module shares.
 *
 * Background modules import `t` from here (not from the barrel) so the
 * worker bundle carries only these keys.
 */
import type { AreaDict } from './types';
import { makeT } from './locale';
import { core } from './core';

export const sw: AreaDict = {
  es: {
    "anki.apiKeyRequired": "AnkiConnect requiere una API key. Configúrala en la tab Cards → Conexión.",
    "anki.mustBeLocal": "La URL de Anki debe apuntar a esta máquina (127.0.0.1 o localhost). Un Anki en otra máquina no está soportado.",
    "cache.bucketAi": "IA (mnemonics/etimología)",
    "cache.bucketEnrichment": "Enriquecimiento (palabras/hover)",
    "cache.bucketExplain": "Explicaciones de frases (IA)",
    "cache.bucketMedia": "Multimedia (dedup audio/imágenes)",
    "cache.bucketTranslations": "Traducciones (subtítulos)",
    "capture.audioInactive": "La captura de audio no está activa — no se adjuntó audio.",
    "capture.noDeck": "No se ha configurado un mazo de Anki (deckName vacío).",
    "capture.noModel": "No se ha configurado un modelo de nota Anki (modelName vacío).",
    "capture.retryTts": "Reintento sin audio original: se usará TTS de la frase.",
    "dictpack.packTooLarge": "Paquete demasiado grande: {total} bytes > {max}",
    "dictpack.packTooLargeShort": "Paquete demasiado grande",
    "sw.noFrameField": "No hay un campo de Anki mapeado a \"frame\"",
    "telem.invalidNotObject": "Snapshot inválido: el archivo no es un objeto JSON.",
    "telem.invalidRow": "Snapshot inválido: una fila tiene campos faltantes o con tipo incorrecto.",
    "telem.missingRows": "Snapshot inválido: falta el array `rows`.",
    "yomitan.emptyIndex": "index.json tiene cero bytes",
    "yomitan.emptyZip": "El ZIP no contiene archivos.",
    "yomitan.noTermBanks": "No se encontraron archivos term_bank ni term_meta_bank en el pack",
  },
  en: {
    "anki.apiKeyRequired": "AnkiConnect requests an API key. Set it in the Cards tab → Connection.",
    "anki.mustBeLocal": "The Anki URL must point at this machine (127.0.0.1 or localhost). An Anki on another machine is not supported.",
    "cache.bucketAi": "AI (mnemonics/etymology)",
    "cache.bucketEnrichment": "Enrichment (words/hover)",
    "cache.bucketExplain": "Sentence explanations (AI)",
    "cache.bucketMedia": "Media (audio/image dedup)",
    "cache.bucketTranslations": "Translations (subtitles)",
    "capture.audioInactive": "Audio capture is not active — no audio attached.",
    "capture.noDeck": "No Anki deck configured (empty deckName).",
    "capture.noModel": "No Anki note model configured (empty modelName).",
    "capture.retryTts": "Retrying without original audio: sentence TTS will be used.",
    "dictpack.packTooLarge": "Pack too large: {total} bytes > {max}",
    "dictpack.packTooLargeShort": "Pack too large",
    "sw.noFrameField": "No Anki field is mapped to \"frame\"",
    "telem.invalidNotObject": "Invalid snapshot: the file is not a JSON object.",
    "telem.invalidRow": "Invalid snapshot: a row has missing or mistyped fields.",
    "telem.missingRows": "Invalid snapshot: missing the `rows` array.",
    "yomitan.emptyIndex": "index.json is zero bytes",
    "yomitan.emptyZip": "The ZIP contains no files.",
    "yomitan.noTermBanks": "No term_bank or term_meta_bank files found in the pack",
  },
};

const { t } = makeT([core, sw]);
export { t };
