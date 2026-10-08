/**
 * Minimal UI i18n: `t(key, vars)` with es/en dictionaries.
 *
 * Locale source: chrome.i18n.getUILanguage() (the browser UI language — the
 * closest thing MV3 gives us to a user-facing preference), falling back to
 * navigator.language and finally Spanish (the default session language).
 *
 * Scope: the strings the audit flagged as mixed ES/EN, starting with the
 * popup and the settings inputs. `t` is intentionally dependency-free so it
 * can be called from components, options, and the popup alike; adding a
 * language means adding one dictionary object below.
 *
 * Convention: keys are `area.thing`, placeholders are `{name}`.
 */
export type Locale = 'es' | 'en';
export type Dict = Record<string, string>;

const es: Dict = {
  // ── popup ────────────────────────────────────────────────────────────
  'popup.phase': 'Fase 2',
  'popup.settings': 'Configuración',
  'popup.retry': 'Reintentar',
  'popup.anki.active': 'AnkiConnect v{v} · activo',
  'popup.anki.checking': 'Comprobando AnkiConnect…',
  'popup.anki.down': 'AnkiConnect no responde',
  'popup.anki.errApiKey': 'AnkiConnect requiere API key — configúrala en Cards → Conexión.',
  'popup.anki.errTimeout': 'AnkiConnect tardó demasiado en responder. Verifica que Anki esté activo.',
  'popup.anki.errGeneric': 'Abre Anki y verifica que AnkiConnect esté instalado. Los subtítulos siguen funcionando sin conexión.',
  'popup.enable.on': 'Extensión activada',
  'popup.enable.off': 'Extensión desactivada',
  'popup.openPanel': 'Abrir panel en la pestaña',
  'popup.capture.title': 'Captura el audio de la pestaña para anexar a las tarjetas Anki',
  'popup.capture.active': 'Captura de audio activa',
  'popup.capture.off': 'Activar captura de audio',
  'popup.capture.failed': 'No se pudo iniciar la captura.',
  'popup.capture.stopped': 'No se pudo detener la captura.',
  'popup.theme.light': 'claro',
  'popup.theme.dark': 'oscuro',
  'popup.theme': 'Tema {mode}',

  // ── secret key inputs ────────────────────────────────────────────────
  'key.guarded': '•••••••• (guardada — escribe para reemplazar)',
  'key.unreadable': 'Clave no legible en este dispositivo (cifrada en otro). Vuelve a introducirla aquí para usarla en este equipo.',
  'key.clear': 'Quitar',
  'key.clearTitle': 'Quitar la clave guardada',
  'key.show': 'Ver',
  'key.hide': 'Ocultar',
  'key.showTitle': 'Mostrar lo escrito',
  'key.hideTitle': 'Ocultar',

  // ── subtitle overlay / panel ──────────────────────────────────────────────
  'app.subtitlesVisible': 'Subtítulos visibles',
  'app.subtitlesHidden': 'Subtítulos ocultos',
  'info.more': 'Más información',
  'overlay.hoverHint': 'hover sobre el subtítulo',
  'overlay.saveSelection': 'Guardar la selección como una sola tarjeta (Ctrl+S)',
  'overlay.clearSelection': 'Limpiar selección',
  'overlay.altScrollHint': 'Alt+Scroll para separar / unir esta expresión',
  'subs.typography': 'Tipografía',
  'subs.size': 'Tamaño',
  'subs.position': 'Posición',
  'subs.nativeFormat': 'Formato nativo',
  'subs.keepWrapHint': 'Respeta los saltos de línea y la alineación originales del archivo de subtítulos (SRT/VTT/ASS). Desactivado, Kivara reconstruye la línea para que ocupe el ancho disponible.',
  'subs.keepLineBreaks': 'Mantener saltos de línea',
  'subs.keepAlignment': 'Mantener alineación',

  // ── word popover ───────────────────────────────────────────────────────
  'popover.loadingMore': 'buscando más…',
  'popover.loadingMoreShort': 'buscando más',
  'popover.playPronunciation': 'Reproducir pronunciación',
  'popover.joinPhrase': 'Unir como expresión',
  'popover.alreadySaved': 'Esta tarjeta ya está en tu mazo',
  'popover.cache': 'Caché',

  // ── dictionary packs ───────────────────────────────────────────────────
  'dict.swNoResponse': 'Service worker no respondió',
  'dict.recommendedCatalog': 'Catálogo recomendado',
  'dict.noneInstalled': 'Aún no has instalado packs. Elige uno del catálogo de arriba.',
  'dict.unusedDisable': 'Sin uso en los últimos 30 días — considera deshabilitarlo',
  'dict.unused30': 'Sin uso en los últimos 30 días',
  'dict.listTitle': 'Título de la lista',
  'dict.noDefinition': 'Sin definición encontrada.',

  // options / settings tab
  'set.quickAccess': 'Acceso rápido',
  'lang.en': 'Inglés',
  'lang.es': 'Español',
  'lang.fr': 'Francés',
  'lang.de': 'Alemán',
  'lang.it': 'Italiano',
  'lang.pt': 'Portugués',
  'lang.ja': 'Japonés (日本語)',
  'lang.ko': 'Coreano (한국어)',
  'lang.zh': 'Chino (中文)',
  'set.autoCapture': 'Captura automática',
  'set.autoCaptureDesc': 'Cuando está activa, Kivara graba audio y captura frame al pulsar guardar, usando VAD para detectar el fin de frase. Desactívala para configurar a mano.',
  'set.hideHoverDesc': 'Oculta los popovers de hover sobre subtítulos. Útil cuando solo quieres mirar la serie sin interrupciones.',
  'set.bilingualSub': 'Subtítulo bilingüe',
  'set.bilingualSubDesc': 'Muestra el subtítulo traducido a tu idioma debajo del original.',
  'set.captureDesc': 'Controla cómo Kivara graba el audio y captura el frame al guardar una tarjeta.',
  'set.micDesc': 'Usa el micrófono del sistema. Útil para clases en vivo o subtítulos externos.',
  'set.tab': 'Pestaña',
  'set.bufferDesc': 'Segundos de audio que se mantienen en memoria. Más buffer = más contexto pero más RAM.',
  'set.vadModeDesc': 'VAD detecta silencios para cortar el audio (más natural).',
  'set.exactModeDesc': 'Corta exactamente cuando termina el cue del subtítulo (más preciso si los cues son buenos).',
  'set.frameDesc': 'Instante del que se toma la captura de pantalla dentro del cue del subtítulo.',
  'set.translate': 'Traducción',
  'set.translateDesc': 'Define qué servicio traduce los subtítulos y palabras. La cadena prueba varios en orden hasta obtener respuesta; el modo único usa solo uno.',
  'set.chainHint': 'Prueba los proveedores activos en orden (free → premium) hasta lograr traducción.',
  'set.singleHint': 'Usa exclusivamente un proveedor — más predecible, sin fallback.',
  'set.single': 'Único',
  'set.chain': 'Cadena',
  'set.ltKeyPlaceholder': '(vacío para instancias públicas)',
  'set.cache': 'Caché',
  'set.dictDesc': 'Diccionarios Yomitan/StarDict locales para hover instantáneo, sin internet ni cuotas de API.',
  'set.sourcesDesc': 'Datos locales bundleados, APIs gratuitas y fuentes VIP opcionales: Cambridge, Oxford, Longman, Dictionary.com, Merriam-Webster, Ozdic, Reverso, Linguee, PROMT.One Contexts, WordReference, SpanishDict, Tatoeba, Forvo, Lingua Libre, Etymonline, imágenes y Google TTS.',
  'set.aiDesc': 'Enriquecimiento opcional con definiciones contextuales, sinónimos y matices generados por un modelo de IA. Tu key se guarda solo en tu navegador.',
  'set.ttsDesc': 'Voces premium para palabra y frase. Si está desactivado se usa la voz nativa del navegador (Web Speech API) sin coste.',
  'set.whisperTitle': 'Transcripción on-device',
  'set.whisperDesc': 'Whisper.cpp local vía WebAssembly: transcribe el audio capturado en tu propio navegador, sin enviar nada a la nube.',
  'set.hideProgressDesc': 'Quita barra de progreso, botones y overlays mientras Kivara está activa.',
  'set.hideGradientsDesc': 'Elimina los degradados sobre los subtítulos para una imagen más nítida.',
  'set.fineSync': 'Sincronización fina',
  'set.fineSyncDesc': 'Ajusta los milisegundos añadidos antes/después de cada cue al capturar audio. Útil si tus tarjetas cortan el inicio o el final de la frase.',
  'set.cueMerge': 'Fusión cues',
  'set.shortcutsDesc': 'Personalízalos: clic en un combo para grabar uno nuevo. Esc cancela, Backspace lo deja sin asignar. Los atajos globales (Ctrl+S, Alt+C, …) se registran en chrome://extensions/shortcuts.',
  'set.testConnection': 'Probar conexión',
  'set.cacheHit': 'Cache hit (la key no se validó)',
  'set.aiMnemonic': 'IA escribe el mnemónico',
  'set.aiEtymology': 'IA escribe la etimología',
};

const en: Dict = {
  'popup.phase': 'Phase 2',
  'popup.settings': 'Settings',
  'popup.retry': 'Retry',
  'popup.anki.active': 'AnkiConnect v{v} · active',
  'popup.anki.checking': 'Checking AnkiConnect…',
  'popup.anki.down': 'AnkiConnect not responding',
  'popup.anki.errApiKey': 'AnkiConnect requires an API key — set it in Cards → Connection.',
  'popup.anki.errTimeout': 'AnkiConnect took too long to respond. Check that Anki is running.',
  'popup.anki.errGeneric': 'Open Anki and check that AnkiConnect is installed. Subtitles keep working offline.',
  'popup.enable.on': 'Extension enabled',
  'popup.enable.off': 'Extension disabled',
  'popup.openPanel': 'Open panel in this tab',
  'popup.capture.title': "Capture the tab's audio to attach to Anki cards",
  'popup.capture.active': 'Audio capture active',
  'popup.capture.off': 'Enable audio capture',
  'popup.capture.failed': 'Could not start the capture.',
  'popup.capture.stopped': 'Could not stop the capture.',
  'popup.theme.light': 'light',
  'popup.theme.dark': 'dark',
  'popup.theme': 'Theme {mode}',

  'key.guarded': '•••••••• (saved — type to replace)',
  'key.unreadable': 'Key not readable on this device (encrypted on another one). Re-enter it here to use it on this machine.',
  'key.clear': 'Clear',
  'key.clearTitle': 'Remove the saved key',
  'key.show': 'Show',
  'key.hide': 'Hide',
  'key.showTitle': 'Show what is typed',
  'key.hideTitle': 'Hide',

  'app.subtitlesVisible': 'Subtitles visible',
  'app.subtitlesHidden': 'Subtitles hidden',
  'info.more': 'More info',
  'overlay.hoverHint': 'hover over the subtitle',
  'overlay.saveSelection': 'Save the selection as a single card (Ctrl+S)',
  'overlay.clearSelection': 'Clear selection',
  'overlay.altScrollHint': 'Alt+Scroll to split / join this expression',
  'subs.typography': 'Typography',
  'subs.size': 'Size',
  'subs.position': 'Position',
  'subs.nativeFormat': 'Native format',
  'subs.keepWrapHint': "Respects the original line breaks and alignment of the subtitle file (SRT/VTT/ASS). When off, Kivara rebuilds the line to fill the available width.",
  'subs.keepLineBreaks': 'Keep line breaks',
  'subs.keepAlignment': 'Keep alignment',

  'popover.loadingMore': 'looking up more…',
  'popover.loadingMoreShort': 'looking up more',
  'popover.playPronunciation': 'Play pronunciation',
  'popover.joinPhrase': 'Join as a phrase',
  'popover.alreadySaved': 'This card is already in your deck',
  'popover.cache': 'Cache',

  'dict.swNoResponse': 'Service worker did not respond',
  'dict.recommendedCatalog': 'Recommended catalog',
  'dict.noneInstalled': "You haven't installed any packs yet. Pick one from the catalog above.",
  'dict.unusedDisable': 'Unused in the last 30 days — consider disabling it',
  'dict.unused30': 'Unused in the last 30 days',
  'dict.listTitle': 'List title',
  'dict.noDefinition': 'No definition found.',

  // options / settings tab
  'set.quickAccess': 'Quick access',
  'lang.en': 'English',
  'lang.es': 'Spanish',
  'lang.fr': 'French',
  'lang.de': 'German',
  'lang.it': 'Italian',
  'lang.pt': 'Portuguese',
  'lang.ja': 'Japanese (日本語)',
  'lang.ko': 'Korean (한국어)',
  'lang.zh': 'Chinese (中文)',
  'set.autoCapture': 'Auto capture',
  'set.autoCaptureDesc': 'When on, Kivara records audio and captures the frame as you hit save, using VAD to detect the end of the sentence. Turn it off to configure manually.',
  'set.hideHoverDesc': 'Hides the hover popovers over subtitles. Useful when you just want to watch the show uninterrupted.',
  'set.bilingualSub': 'Bilingual subtitle',
  'set.bilingualSubDesc': 'Shows the subtitle translated into your language below the original.',
  'set.captureDesc': 'Controls how Kivara records audio and captures the frame when saving a card.',
  'set.micDesc': 'Uses the system microphone. Useful for live classes or external subtitles.',
  'set.tab': 'Tab',
  'set.bufferDesc': 'Seconds of audio kept in memory. More buffer = more context but more RAM.',
  'set.vadModeDesc': 'VAD detects silences to cut the audio (more natural).',
  'set.exactModeDesc': 'Cuts exactly when the subtitle cue ends (more precise when the cues are good).',
  'set.frameDesc': 'The moment the screenshot is taken from within the subtitle cue.',
  'set.translate': 'Translation',
  'set.translateDesc': 'Defines which service translates subtitles and words. Chain mode tries several in order until one responds; single mode uses only one.',
  'set.chainHint': 'Tries the active providers in order (free → premium) until a translation is found.',
  'set.singleHint': 'Uses a single provider — more predictable, no fallback.',
  'set.single': 'Single',
  'set.chain': 'Chain',
  'set.ltKeyPlaceholder': '(empty for public instances)',
  'set.cache': 'Cache',
  'set.dictDesc': 'Local Yomitan/StarDict dictionaries for instant hover, with no internet or API quotas.',
  'set.sourcesDesc': 'Bundled local data, free APIs and optional VIP sources: Cambridge, Oxford, Longman, Dictionary.com, Merriam-Webster, Ozdic, Reverso, Linguee, PROMT.One Contexts, WordReference, SpanishDict, Tatoeba, Forvo, Lingua Libre, Etymonline, images and Google TTS.',
  'set.aiDesc': 'Optional enrichment with contextual definitions, synonyms and nuances generated by an AI model. Your key is stored only in your browser.',
  'set.ttsDesc': 'Premium voices for word and sentence. When off, the browser\'s native voice (Web Speech API) is used at no cost.',
  'set.whisperTitle': 'On-device transcription',
  'set.whisperDesc': 'Local Whisper.cpp via WebAssembly: transcribes the captured audio in your own browser, sending nothing to the cloud.',
  'set.hideProgressDesc': 'Hides the progress bar, buttons and overlays while Kivara is active.',
  'set.hideGradientsDesc': 'Removes the gradients over the subtitles for a crisper image.',
  'set.fineSync': 'Fine sync',
  'set.fineSyncDesc': 'Adjusts the milliseconds added before/after each cue when capturing audio. Useful if your cards cut the start or end of the sentence.',
  'set.cueMerge': 'Cue merging',
  'set.shortcutsDesc': 'Customize them: click a combo to record a new one. Esc cancels, Backspace clears it. Global shortcuts (Ctrl+S, Alt+C, …) are managed in chrome://extensions/shortcuts.',
  'set.testConnection': 'Test connection',
  'set.cacheHit': 'Cache hit (the key was not validated)',
  'set.aiMnemonic': 'AI writes the mnemonic',
  'set.aiEtymology': 'AI writes the etymology',
};
function detectLocale(): Locale {
  try {
    const chromeI18n = (globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } }).chrome?.i18n;
    const fromChrome = chromeI18n?.getUILanguage?.();
    const tag = fromChrome || (typeof navigator !== 'undefined' ? navigator.language : '') || 'es';
    return /^en\b/i.test(tag) ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

const LOCALE: Locale = detectLocale();

export function currentLocale(): Locale {
  return LOCALE;
}

/** Translate `key` into the detected locale. Unknown keys fall back to the
 * Spanish dictionary, then to the key itself (so a missing string is
 * visible in the UI instead of blank). `{name}` placeholders are replaced. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = LOCALE === 'en' ? en : es;
  let out = dict[key] ?? es[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}
