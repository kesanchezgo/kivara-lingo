/**
 * i18n area: popup — the toolbar popup
 *
 * Split out of the flat dictionary in F0 (docs/REDESIGN-V2.md §3 H6) so the
 * service worker can carry only the strings it emits.
 */
import type { AreaDict } from './types';

export const popup: AreaDict = {
  es: {
    "popup.anki.active": "AnkiConnect v{v} · activo",
    "popup.anki.checking": "Comprobando AnkiConnect…",
    "popup.anki.down": "AnkiConnect no responde",
    "popup.anki.errApiKey": "AnkiConnect pide una clave de API: añádela en Tarjetas › Conexión.",
    "popup.anki.errGeneric": "Abre Anki y verifica que AnkiConnect esté instalado. Los subtítulos siguen funcionando sin conexión.",
    "popup.anki.errTimeout": "AnkiConnect tardó demasiado en responder. Verifica que Anki esté activo.",
    "popup.capture.active": "Captura de audio activa",
    "popup.capture.failed": "No se pudo iniciar la captura.",
    "popup.capture.off": "Activar captura de audio",
    "popup.capture.stopped": "No se pudo detener la captura.",
    "popup.capture.title": "Graba el audio de la pestaña para añadirlo a tus tarjetas de Anki",
    "popup.enable.off": "Extensión desactivada",
    "popup.enable.on": "Extensión activada",
    "popup.openPanel": "Abrir panel en la pestaña",
    "popup.phase": "Prototipo",
    "popup.queued": "{n} tarjetas en cola: se enviarán cuando Anki responda",
    "popup.queuedOne": "1 tarjeta en cola: se enviará cuando Anki responda",
    "popup.retry": "Reintentar",
    "popup.settings": "Preferencias",
    "popup.theme": "Tema {mode}",
    "popup.theme.dark": "oscuro",
    "popup.theme.light": "claro",
  },
  en: {
    "popup.anki.active": "AnkiConnect v{v} · active",
    "popup.anki.checking": "Checking AnkiConnect…",
    "popup.anki.down": "AnkiConnect not responding",
    "popup.anki.errApiKey": "AnkiConnect needs an API key: add it in Cards › Connection.",
    "popup.anki.errGeneric": "Open Anki and check that AnkiConnect is installed. Subtitles keep working offline.",
    "popup.anki.errTimeout": "AnkiConnect took too long to respond. Check that Anki is running.",
    "popup.capture.active": "Audio capture active",
    "popup.capture.failed": "Could not start the capture.",
    "popup.capture.off": "Enable audio capture",
    "popup.capture.stopped": "Could not stop the capture.",
    "popup.capture.title": "Records the tab audio to add it to your Anki cards",
    "popup.enable.off": "Extension disabled",
    "popup.enable.on": "Extension enabled",
    "popup.openPanel": "Open panel in this tab",
    "popup.phase": "Prototype",
    "popup.queued": "{n} cards queued: they'll be sent when Anki responds",
    "popup.queuedOne": "1 card queued: it'll be sent when Anki responds",
    "popup.retry": "Retry",
    "popup.settings": "Preferences",
    "popup.theme": "Theme {mode}",
    "popup.theme.dark": "dark",
    "popup.theme.light": "light",
  },
};
