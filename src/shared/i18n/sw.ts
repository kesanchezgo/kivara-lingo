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
    "anki.badList": "AnkiConnect no devolvió una lista válida para {action}.",
    "anki.badRecordCount": "AnkiConnect devolvió menos registros que notas ({action}).",
    "anki.http": "AnkiConnect respondió {status}.",
    "anki.loopbackRefused": "La URL de Anki no es local: solo se acepta AnkiConnect en esta máquina.",
    "anki.mustBeLocal": "La URL de Anki debe apuntar a esta máquina (127.0.0.1 o localhost). Un Anki en otra máquina no está soportado.",
    "anki.network": "No se pudo contactar AnkiConnect ({reason}). ¿Está Anki abierto y AnkiConnect instalado?",
    "anki.timeout": "AnkiConnect tardó más de {ms}ms en responder.",
    "anki.unknown": "Error desconocido contactando AnkiConnect.",
    "anki.unreadable": "AnkiConnect devolvió una respuesta ilegible ({reason}). ¿Está algo más escuchando en {url}?",
    "cache.bucketAi": "IA (mnemonics/etimología)",
    "cache.bucketEnrichment": "Enriquecimiento (palabras/hover)",
    "cache.bucketExplain": "Explicaciones de frases (IA)",
    "cache.bucketMedia": "Multimedia (dedup audio/imágenes)",
    "cache.bucketTranslations": "Traducciones (subtítulos)",
    "app.noWordAudio": "Sin audio de la palabra: activa una fuente de pronunciación en Preferencias › Enriquecimiento.",
    "app.noWordAudioAccess": "Sin audio de la palabra: da acceso a sus fuentes en Preferencias › Acceso a sitios.",
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
    "anki.badList": "AnkiConnect did not return a valid list for {action}.",
    "anki.badRecordCount": "AnkiConnect returned fewer records than notes ({action}).",
    "anki.http": "AnkiConnect responded with {status}.",
    "anki.loopbackRefused": "The Anki URL is not loopback; the extension refuses remote Anki endpoints. Configure AnkiConnect on this machine.",
    "anki.mustBeLocal": "The Anki URL must point at this machine (127.0.0.1 or localhost). An Anki on another machine is not supported.",
    "anki.network": "Could not reach AnkiConnect ({reason}). Is Anki open and AnkiConnect installed?",
    "anki.timeout": "AnkiConnect timed out after {ms}ms.",
    "anki.unknown": "Unknown error contacting AnkiConnect.",
    "anki.unreadable": "AnkiConnect returned an unreadable response ({reason}). Is something else listening on {url}?",
    "cache.bucketAi": "AI (mnemonics/etymology)",
    "cache.bucketEnrichment": "Enrichment (words/hover)",
    "cache.bucketExplain": "Sentence explanations (AI)",
    "cache.bucketMedia": "Media (audio/image dedup)",
    "cache.bucketTranslations": "Translations (subtitles)",
    "app.noWordAudio": "No word audio: turn on a pronunciation source in Preferences › Enrichment.",
    "app.noWordAudioAccess": "No word audio: allow its sources in Preferences › Site access.",
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
