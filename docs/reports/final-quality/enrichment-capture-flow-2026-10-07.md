# Flujo frame + audio de la frase — verificado en código — 2026-10-07

La imagen de la tarjeta es el FOTOGRAMA del vídeo/serie en el momento de la
frase (con su subtítulo), y el audio es el CLIP EXACTO de la frase. Las
imágenes web quedan como secundarias (fallback). Verificado por lectura
completa del flujo; la prueba viva en HBO/Netflix/Prime sigue pendiente
porque las cookies aportadas no traen sesión válida.

## Frame: cue → `captureBestFrame` → `request.frame` → Anki

1. `App.tsx handleSaveCard` (líneas 690-699): si hay `videoElement`,
   llama `captureBestFrame(videoElement, { start: activeCue?.start,
   end: activeCue?.end })` con la ventana del subtítulo activo.
2. `frame.ts captureBestFrame`:
   - Siempre toma el frame en pantalla primero (costo cero, sin seek).
   - Fast path: si ya es usable, lo devuelve sin tocar el playhead.
   - Vídeo reproduciendo: espera hasta 3 frames decodificados
     (`requestVideoFrameCallback`) sin seek (sin salto visible).
   - Vídeo pausado + cue conocida: muestrea inicio/mitad/fin de la
     ventana y restaura el playhead original en `finally`.
   - Devuelve el mejor por `scoreFrameQuality` o `null` si todo es
     fundido/spinner/título plano → el orquestador cae a imagen web.
3. `capture-orchestrator.ts` líneas 553-563: el `frame` (data URL) se
   guarda vía AnkiConnect `storeMediaFile` en el campo mapeado a `frame`.
   Si no hubo frame pero el campo existe, la imagen web lo cubre.
4. `Alt+V` (`recapture_frame`): re-captura el frame actual y parchea la
   nota recién guardada (`UPDATE_NOTE_FRAME`).

## Audio: cue → anchor → ring buffer → clip → Anki

1. `App.tsx ensureSubtitleAudioReady` (líneas 626-679): si el vídeo está
   pausado ANTES del fin del cue, lo reproduce hasta `cue.end + 0.25s`,
   toma el anchor (`currentTime` real) y restaura la pausa y el playhead.
   Si falla, marca `videoPausedAtSave: true` para que el extractor no
   fabrique un clip roto.
2. `request` lleva `cueStart/cueEnd/videoTimeAtSave/videoPausedAtSave`.
3. `capture-orchestrator.ts resolveAudio` (líneas 210-281):
   - `computeCueWindow` traduce vídeo-tiempo → wall-clock del ring buffer
     (misma matemática en todas las plataformas: cada adapter alimenta
     los mismos 3 números).
   - Si la cola del cue está en el futuro y el vídeo quedó pausado →
     `null` y el llamador pone TTS de la frase (mejor que silencio).
   - Si no, espera lo justo (`waitForCueTailMs`, tope 8s) y extrae con
     VAD (recorta a voz real) en WAV 16kHz mono.
4. El clip se adjunta como `[sound:...]` al campo `sentence-audio`
   (fallback `tabCapture`); si no hay captura activa, TTS sintetiza la
   frase para que Anki siempre tenga audio.

## Por qué es correcto sin prueba viva

- La matemática `cue-window.ts` es pura y tiene tests (`cue-window.test.ts`).
- `scoreFrameQuality` es pura y tiene tests (`frame-quality.test.ts`).
- Los adapters alimentan los mismos 3 números en Netflix/Prime/HBO/YouTube.
- Cada fallo degrada a algo legible: frame nulo → imagen web; audio
  imposible → TTS de la frase; nada lanza ni deja la tarjeta a medias.

## Prueba viva pendiente (la debe hacer el usuario con sesión)

1. Abrir serie con subtítulos EN, hover en palabra → popover con traducción.
2. Guardar tarjeta a mitad de frase → verificar frame = escena del cue.
3. Pausar en fundido → guardar → frame debe ser escena usable, no negro.
4. Revisar en Anki: audio = la frase exacta (no TTS robótico salvo fallback
   avisado), imagen = frame, resto de campos A/B según este reporte.
