# Kivara Lingo — Especificación de implementación

> Documento dirigido a la IA / equipo que implementará la extensión real a partir del prototipo de UI/UX. Este documento es la **única fuente de verdad** sobre qué hay que construir, con qué tecnologías y cómo cada pieza encaja con el resto.

**Audiencia:** ingeniero (humano o IA) con experiencia en TypeScript, React y APIs de navegador. No asume conocimiento previo del dominio (subtítulos, Anki, ASR).

**Alcance:** convertir el prototipo React (`src/app/`) en una **extensión Chromium / Firefox (Manifest V3)** que funcione real sobre Netflix, HBO Max, Disney+, Prime Video y YouTube, integrada con Anki vía AnkiConnect.

---

## 0. Tabla de contenidos

1. [Visión y principios de diseño](#1-visión-y-principios-de-diseño)
2. [Arquitectura general](#2-arquitectura-general)
3. [Stack tecnológico definitivo](#3-stack-tecnológico-definitivo)
4. [Estructura de carpetas final](#4-estructura-de-carpetas-final)
5. [Manifest V3 — configuración exacta](#5-manifest-v3--configuración-exacta)
6. [Módulos del sistema](#6-módulos-del-sistema)
7. [Adaptadores por plataforma de streaming](#7-adaptadores-por-plataforma-de-streaming)
8. [Captura de audio y fotograma](#8-captura-de-audio-y-fotograma)
9. [Reconocimiento y traducción](#9-reconocimiento-y-traducción)
10. [Tokenización y MWE](#10-tokenización-y-mwe)
11. [Integración con Anki (AnkiConnect)](#11-integración-con-anki-ankiconnect)
12. [Modelo de datos y persistencia](#12-modelo-de-datos-y-persistencia)
13. [UI: del prototipo a la realidad](#13-ui-del-prototipo-a-la-realidad)
14. [Atajos de teclado](#14-atajos-de-teclado)
15. [Permisos, privacidad y seguridad](#15-permisos-privacidad-y-seguridad)
16. [Performance y límites](#16-performance-y-límites)
17. [Testing](#17-testing)
18. [Build, empaquetado y publicación](#18-build-empaquetado-y-publicación)
19. [Roadmap por fases](#19-roadmap-por-fases)
20. [Glosario](#20-glosario)

---

## 1. Visión y principios de diseño

### 1.1 Producto

Extensión de navegador que se monta sobre reproductores de streaming y convierte sus subtítulos en una herramienta de aprendizaje de vocabulario integrada con Anki.

### 1.2 Principios no negociables

1. **Mínima fricción.** Tres acciones máximo entre "no entender una palabra" y "tarjeta guardada en Anki": hover, leer, clic. Ninguna pausa de video requerida.
2. **No invadir.** La UI sobre el video debe ser invisible cuando el usuario solo quiere ver. El modo Lectura es de primera clase, no opcional.
3. **Local primero.** Diccionarios, MWE, deduplicación y caché viven en el navegador. Llamadas externas (TTS, ASR, traducción) son fallback, no requisito.
4. **Plataforma-agnóstico.** El núcleo no sabe si está sobre Netflix o YouTube. Cada plataforma se aísla en un *adapter*.
5. **Anki como ciudadano de primera.** El mapeo de campos es configurable, no asumido. Cualquier *note type* del usuario debe poder funcionar.
6. **No romper la experiencia base.** Si la extensión falla, el video debe seguir funcionando.

---

## 2. Arquitectura general

### 2.1 Diagrama de bloques

```
┌─────────────────────────────────────────────────────────────────┐
│                      Pestaña del navegador                      │
│                                                                 │
│  ┌──────────────────────────────────────┐  ┌────────────────┐  │
│  │  Reproductor de la plataforma        │  │  Content UI     │  │
│  │  (Netflix, YouTube, ...)             │  │  (React, Shadow │  │
│  │                                       │  │   DOM)          │  │
│  │  ┌────────────────────────────────┐  │  │                 │  │
│  │  │  Subtítulo nativo (oculto)     │  │  │  - Subtitle     │  │
│  │  └────────────────────────────────┘  │  │    overlay      │  │
│  │                                       │  │  - Word popover │  │
│  │  ┌────────────────────────────────┐  │  │  - Side panel   │  │
│  │  │  Subtitle Overlay (Kivara)     │  │  │  - Toasts       │  │
│  │  │  ← inyectado por content script│  │  │                 │  │
│  │  └────────────────────────────────┘  │  └────────────────┘  │
│  └──────────────────────────────────────┘                       │
│                       ▲                                          │
│                       │ messages (chrome.runtime)                │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Platform Adapter (Netflix / YouTube / ...)              │   │
│  │  - extrae cues, frame rate, currentTime, seek            │   │
│  │  - expone API uniforme: SubtitleSource                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                       ▲
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Service Worker (background)                                    │
│  - AnkiConnect proxy (CORS-free)                                │
│  - TTS / ASR / translate API calls                              │
│  - chrome.tabCapture (audio)                                    │
│  - Storage (chrome.storage.local + sync)                        │
│  - Settings, deduplicación de tarjetas                          │
└─────────────────────────────────────────────────────────────────┘
                       ▲
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Popup (toolbar)                                                │
│  - Toggle on/off de la extensión                                │
│  - Atajo "abrir panel"                                          │
│  - Estado: conectado a Anki, modo activo                        │
└─────────────────────────────────────────────────────────────────┘
                       ▲
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Options page (chrome-extension://.../options.html)             │
│  - Configuración avanzada (mapeo Anki, atajos, perfiles)        │
│  - Equivalente a las pestañas Cards / Settings del prototipo    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Flujo de datos: "guardar tarjeta"

1. Usuario hace hover sobre `these days` en el subtítulo overlay.
2. `content/subtitle-overlay.tsx` consulta el `dictionary` local → muestra `WordPopover`.
3. Usuario hace clic en "Guardar".
4. Content envía `{ type: 'CREATE_CARD', payload: { token, cue, sentence, time } }` al service worker.
5. Service worker:
   - Llama al `platform adapter` para `getCurrentTime()` y `getActiveCue()`.
   - Pide al `capture` module: `captureFrame(time)` + `captureAudioWindow(cueStart, cueEnd)`.
   - Resuelve traducciones / fonéticas faltantes (caché → API).
   - Construye el payload Anki según `mapping` del usuario.
   - Llama a AnkiConnect (`addNote`).
6. Service worker responde `{ ok: true, noteId }` o `{ ok: false, error }`.
7. Content muestra toast (sonner-equivalente) confirmando.

---

## 3. Stack tecnológico definitivo

### 3.1 Core

| Capa | Tecnología | Por qué |
|---|---|---|
| Lenguaje | TypeScript 5.x estricto | Tipado de mensajes entre contextos es crítico. |
| Framework UI | React 18 | Reusa todo el prototipo. |
| Estilos | Tailwind CSS v4 | Reusa `theme.css`, `sl-*` clases. |
| Build | **Vite + `@crxjs/vite-plugin`** | Vite con HMR funciona en MV3 vía `@crxjs/vite-plugin`. Es el estándar actual; webpack está descontinuado para extensiones. |
| Empaquetado | `web-ext` (Mozilla) | CLI para validar y firmar Firefox. Para Chrome se sube el zip producido por Vite. |
| Manifest | **Manifest V3** | Obligatorio en Chrome desde 2024. |
| Cross-browser | `webextension-polyfill` | Wrapping de `chrome.*` → `browser.*` con Promesas, funciona en ambos. |

### 3.2 Librerías de runtime

| Función | Librería | Notas |
|---|---|---|
| Estado global | **Zustand** | Más liviano que Redux, persiste con `persist` middleware en `chrome.storage.local`. |
| Mensajería typed | **`webext-bridge`** | Mensajes entre content / background / popup con tipos TS. Evita reinventar `chrome.runtime.sendMessage`. |
| UI primitives | Reusar `shadcn/ui` o headless si el prototipo lo introduce | Por ahora el prototipo usa Tailwind + componentes propios. Mantener. |
| Iconos | `lucide-react` | Idem prototipo. |
| Toasts | **`sonner`** | Idem prototipo. Funciona dentro de Shadow DOM. |
| Drag (panel flotante) | `react-dnd` o `@use-gesture/react` | Para mover el panel cuando es popup. |
| Tokenización avanzada | `intl-segmenter-polyfill` (fallback) | `Intl.Segmenter` está en navegadores modernos; útil para CJK. |
| Detección de idioma | **`franc-min`** o `cld3-asm` | Para no aplicar inglés sobre subtítulos en alemán. |

### 3.3 APIs de navegador (qué usar para cada cosa)

| Necesidad | API | Detalles |
|---|---|---|
| Inyectar UI sobre la página | `content_scripts` + **Shadow DOM** | El Shadow DOM aísla los estilos del CSS de Netflix/YouTube. Renderizar React dentro de un host shadow. |
| Capturar audio de la pestaña | `chrome.tabCapture.capture()` | Devuelve un `MediaStream`. Solo funciona si la pestaña tiene el foco y el usuario activa la extensión. |
| Capturar frame del video | `<video>.captureStream()` + `OffscreenCanvas` | Dibujar el frame y exportar como `Blob` PNG. Más barato que `chrome.tabs.captureVisibleTab` (que captura toda la pestaña). |
| Inyectar JS en el contexto MAIN | `chrome.scripting.executeScript({ world: 'MAIN' })` | Necesario para acceder al `<video>` element y a las APIs internas de Netflix (algunos players lo aíslan). |
| Storage de settings | `chrome.storage.sync` (≤100KB) | Para preferencias del usuario. Sincroniza entre dispositivos. |
| Storage de caché | `chrome.storage.local` o **IndexedDB** | Para diccionarios, audio cacheado, screenshots. IndexedDB para >5MB. |
| Atajos | `commands` en manifest | `Ctrl+S`, `Alt+C`, etc. Configurables por el usuario en `chrome://extensions/shortcuts`. |
| Comunicación con AnkiConnect | `fetch('http://127.0.0.1:8765')` desde service worker | Localhost no requiere CORS desde una extensión con el host permission correcto. |
| Offscreen audio decoding | `chrome.offscreen.createDocument()` | MV3 service workers no tienen DOM ni Audio API; usar offscreen document para procesar audio. |

### 3.4 Servicios externos (todos opcionales, con fallback)

| Servicio | Uso | Recomendación |
|---|---|---|
| Traducción | LibreTranslate (self-host), DeepL Free, Google Translate API | Usuario configura su clave en Options. Si no hay clave, traducción = solo del diccionario local. |
| TTS de palabra | `SpeechSynthesisUtterance` (Web Speech API) | Gratis, offline, calidad media. Fallback: ElevenLabs / Google Cloud TTS. |
| ASR (forced alignment) | `whisper.cpp` vía WASM, o servidor self-host | Para subtítulos malalineados. Es un *nice-to-have*, no MVP. |
| Diccionarios | Wiktextract dumps (offline), Lexicala API | El MVP usa diccionario bundled (top 5000 palabras del idioma objetivo). |

---

## 4. Estructura de carpetas final

```
kivara-lingo-extension/
├── manifest.json                       # Manifest V3
├── vite.config.ts                      # Vite + @crxjs/vite-plugin
├── package.json
├── tsconfig.json
├── README.md
├── IMPLEMENTATION.md                   # este documento
│
├── src/
│   ├── background/
│   │   ├── service-worker.ts           # entrypoint MV3
│   │   ├── anki-connect.ts             # cliente AnkiConnect
│   │   ├── capture-orchestrator.ts     # coordina audio + frame
│   │   ├── translate.ts                # adaptadores de servicios externos
│   │   ├── tts.ts
│   │   └── messaging.ts                # webext-bridge handlers
│   │
│   ├── content/
│   │   ├── index.tsx                   # entrypoint del content script
│   │   ├── shadow-host.ts              # crea Shadow DOM y monta React
│   │   ├── platform-adapters/
│   │   │   ├── index.ts                # detecta plataforma y devuelve adapter
│   │   │   ├── types.ts                # interface SubtitleSource
│   │   │   ├── netflix.ts
│   │   │   ├── youtube.ts
│   │   │   ├── disney-plus.ts
│   │   │   ├── hbo-max.ts
│   │   │   ├── prime-video.ts
│   │   │   └── generic-html5.ts        # fallback: <video> + <track>
│   │   ├── ui/
│   │   │   ├── SubtitleOverlay.tsx     # equivale al subtítulo del prototipo
│   │   │   ├── WordPopover.tsx         # del prototipo
│   │   │   ├── SidePanel.tsx           # ExtensionPanel del prototipo
│   │   │   ├── tabs/
│   │   │   │   ├── SubtitlesTab.tsx
│   │   │   │   ├── CardsTab.tsx
│   │   │   │   └── SettingsTab.tsx
│   │   │   └── Toaster.tsx             # wrapper de sonner dentro del shadow
│   │   ├── nlp/
│   │   │   ├── tokenize.ts             # tokenizeSentence del prototipo
│   │   │   ├── mwe-registry.ts         # carga el JSON de MWEs
│   │   │   └── dictionary.ts           # consulta diccionario local
│   │   └── capture/
│   │       ├── frame.ts                # video.captureStream + OffscreenCanvas
│   │       └── vad.ts                  # voice activity detection (silero VAD wasm)
│   │
│   ├── popup/
│   │   ├── index.html
│   │   ├── Popup.tsx                   # toggle on/off + estado AnkiConnect
│   │   └── main.tsx
│   │
│   ├── options/
│   │   ├── index.html
│   │   ├── Options.tsx                 # mismas tabs Cards / Settings del prototipo
│   │   └── main.tsx
│   │
│   ├── offscreen/
│   │   ├── offscreen.html              # documento offscreen para audio
│   │   └── audio-processor.ts
│   │
│   ├── shared/
│   │   ├── types.ts                    # SubtitleStyles, AnkiMapping, FieldSource, Message
│   │   ├── store.ts                    # Zustand store (persistido en chrome.storage)
│   │   ├── constants.ts
│   │   └── utils.ts
│   │
│   ├── assets/
│   │   ├── icons/                      # 16/32/48/128
│   │   ├── dictionaries/
│   │   │   ├── en.json                 # diccionario inglés bundled
│   │   │   └── ...
│   │   └── mwes/
│   │       ├── en.json                 # MWE registry inglés
│   │       └── ...
│   │
│   └── styles/
│       ├── theme.css                   # tokens, dark mode, sl-* clases (del prototipo)
│       └── shadow.css                  # CSS adicional para inyección en Shadow DOM
│
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/                            # Playwright contra páginas reales (sandbox)
```

---

## 5. Manifest V3 — configuración exacta

```json
{
  "manifest_version": 3,
  "name": "Kivara Lingo",
  "version": "0.1.0",
  "description": "Aprende idiomas mientras ves tu serie favorita.",
  "icons": {
    "16": "assets/icons/16.png",
    "32": "assets/icons/32.png",
    "48": "assets/icons/48.png",
    "128": "assets/icons/128.png"
  },
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": "assets/icons/32.png",
    "default_title": "Kivara Lingo"
  },
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "options_ui": {
    "page": "options/index.html",
    "open_in_tab": true
  },
  "content_scripts": [
    {
      "matches": [
        "*://*.netflix.com/*",
        "*://*.youtube.com/*",
        "*://*.disneyplus.com/*",
        "*://*.hbomax.com/*",
        "*://*.max.com/*",
        "*://*.primevideo.com/*"
      ],
      "js": ["content/index.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "permissions": [
    "storage",
    "tabCapture",
    "scripting",
    "offscreen",
    "activeTab"
  ],
  "host_permissions": [
    "http://127.0.0.1:8765/*",
    "https://api-free.deepl.com/*",
    "https://translation.googleapis.com/*"
  ],
  "commands": {
    "save-card": {
      "suggested_key": { "default": "Ctrl+S", "mac": "Command+S" },
      "description": "Guardar tarjeta de la palabra/expresión bajo el cursor"
    },
    "toggle-subtitles": {
      "suggested_key": { "default": "Alt+C" },
      "description": "Mostrar / ocultar subtítulos de Kivara"
    },
    "repeat-line": {
      "suggested_key": { "default": "Alt+R" },
      "description": "Repetir el último cue"
    },
    "recapture-frame": {
      "suggested_key": { "default": "Alt+V" },
      "description": "Re-capturar el fotograma del cue actual"
    },
    "toggle-panel": {
      "suggested_key": { "default": "Alt+K" },
      "description": "Abrir / cerrar panel de Kivara"
    }
  },
  "web_accessible_resources": [
    {
      "resources": ["assets/*", "offscreen/offscreen.html"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

**Notas críticas:**

- `tabCapture` requiere que el usuario invoque la extensión (clic en el icono) o un atajo. No se puede capturar audio "en silencio".
- `host_permissions` para `127.0.0.1:8765` evita CORS contra AnkiConnect.
- `all_frames: false` para no inyectarse en iframes de anuncios.
- Si se publica en Firefox, añadir `"browser_specific_settings": { "gecko": { "id": "kivara-lingo@kivara.app" } }`.

---

## 6. Módulos del sistema

### 6.1 Content Script (`src/content/index.tsx`)

Responsabilidades:

1. Detectar la plataforma (`platform-adapters/index.ts`).
2. Crear un host con Shadow DOM sobre el `<video>`.
3. Montar React dentro del shadow con `SubtitleOverlay` y `SidePanel`.
4. Suscribirse al stream de cues del adapter y re-renderizar el subtítulo en cada cambio.
5. Ocultar el subtítulo nativo de la plataforma (CSS injection vía adapter).
6. Manejar interacciones (hover, scroll, Alt) y disparar mensajes al service worker.

Esqueleto:

```ts
// src/content/index.tsx
import { createRoot } from 'react-dom/client';
import { detectPlatform } from './platform-adapters';
import { ShadowHost } from './shadow-host';
import { App } from './ui/App';

(async () => {
  const adapter = await detectPlatform();
  if (!adapter) return;

  await adapter.waitForVideo();
  adapter.hideNativeSubtitles();

  const host = ShadowHost.mount(adapter.getVideoElement());
  createRoot(host.reactRoot).render(<App adapter={adapter} />);
})();
```

### 6.2 Service Worker (`src/background/service-worker.ts`)

Responsabilidades:

1. Recibir mensajes del content y popup vía `webext-bridge`.
2. Coordinar captura (audio + frame).
3. Enriquecer datos: traducción, fonética, audio TTS si faltan.
4. Hablar con AnkiConnect.
5. Persistir caché y deduplicar.
6. Manejar atajos globales (`chrome.commands.onCommand`).

Recordatorio MV3: el service worker se duerme tras 30s sin actividad. **No usar variables globales como caché**; usar `chrome.storage.session` o IndexedDB.

### 6.3 Shadow Host (`src/content/shadow-host.ts`)

```ts
export class ShadowHost {
  static mount(videoEl: HTMLVideoElement) {
    const host = document.createElement('div');
    host.id = 'kivara-lingo-host';
    host.style.cssText = 'all: initial; position: absolute; inset: 0; pointer-events: none;';
    videoEl.parentElement!.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const reactRoot = document.createElement('div');
    reactRoot.style.cssText = 'pointer-events: auto;';
    shadow.appendChild(reactRoot);

    // Inyectar Tailwind compilado dentro del shadow
    const style = document.createElement('style');
    style.textContent = TAILWIND_CSS_AS_STRING; // import como ?inline en Vite
    shadow.appendChild(style);

    return { host, shadow, reactRoot };
  }
}
```

---

## 7. Adaptadores por plataforma de streaming

### 7.1 Interface uniforme

```ts
// src/content/platform-adapters/types.ts
export interface SubtitleCue {
  id: string;
  start: number;        // segundos
  end: number;
  text: string;
  language: string;     // BCP-47: 'en', 'es-MX'
}

export interface SubtitleSource {
  platform: 'netflix' | 'youtube' | 'disney' | 'hbo' | 'prime' | 'generic';
  getVideoElement(): HTMLVideoElement;
  waitForVideo(): Promise<void>;
  getCurrentTime(): number;
  seek(t: number): void;
  setPlaybackRate(rate: number): void;
  pause(): void;
  play(): void;
  /** Stream de cues activos (puede ser 0, 1 o más simultáneos). */
  onCueChange(cb: (cues: SubtitleCue[]) => void): () => void;
  /** Lista de tracks de subtítulo disponibles. */
  getAvailableTracks(): Promise<{ language: string; label: string }[]>;
  setActiveTrack(language: string): Promise<void>;
  hideNativeSubtitles(): void;
  showNativeSubtitles(): void;
}
```

### 7.2 Estrategias por plataforma

| Plataforma | Cómo obtener cues |
|---|---|
| **Netflix** | Interceptar `XMLHttpRequest`/`fetch` para `nflxvideo.net/?o=...&v=...` (pista TTML/WebVTT). Parsear con `vtt.js` o parser propio. Alternativa robusta: hookear `cadmium-playercore` desde el contexto MAIN. |
| **YouTube** | Usar `<video>.textTracks` directamente (HTML5 `<track>`). Si falta, llamar al endpoint `youtube.com/api/timedtext`. |
| **Disney+** | Tracks WebVTT vía `<video>.textTracks`. Player es Shaka — accesible vía `window.shakaPlayer` en algunos builds. |
| **HBO Max / Max** | Player propio. Interceptar manifest HLS/DASH y extraer pistas WebVTT externas. |
| **Prime Video** | Player con TTML embebido. Interceptar `fetch` a `loadcaption`. |
| **Generic HTML5** | `<video>.textTracks` — funciona para cualquier sitio con `<track>`. |

**Patrón común:** cada adapter expone un `EventEmitter`-style `onCueChange`. El content script no sabe cómo se obtuvieron los cues, solo los recibe.

### 7.3 Inyección en contexto MAIN

Algunos adapters (Netflix, Prime) requieren acceso a objetos del player que viven en el `MAIN world`. Usar:

```ts
chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',
  files: ['platform-adapters/netflix-main.js'],
});
```

El script en MAIN se comunica con el content script (ISOLATED) vía `window.postMessage` con un namespace propio.

---

## 8. Captura de audio y fotograma

### 8.1 Frame (screenshot del cue)

```ts
// src/content/capture/frame.ts
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}
```

**Importante:** Netflix y otros DRM-protected videos pueden lanzar `SecurityError` (canvas tainted). Mitigación:
- Detectar el error y mostrar al usuario "captura de frame no disponible para este contenido".
- Alternativa: `chrome.tabs.captureVisibleTab()` — pero captura toda la pestaña, no solo el video. Recortar después.

### 8.2 Audio del cue

Flujo real (implementado en `src/offscreen/audio-processor.ts`):

1. **Service Worker** llama `chrome.tabCapture.getMediaStreamId({ targetTabId })` y lo pasa al offscreen.
2. **Offscreen Document** se crea con `reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK']`. El `AUDIO_PLAYBACK` es necesario porque, al consumir el `MediaStream` con `getUserMedia({ chromeMediaSource: 'tab' })`, el audio original de la pestaña se silencia — hay que re-rutearlo manualmente a `AudioContext.destination` para que el usuario lo siga oyendo.
3. `MediaRecorder` graba un buffer rolling WebM/Opus (default 30s, ajustable en Settings).
4. Cuando se dispara "guardar tarjeta", el SW envía `OFFSCREEN_EXTRACT_AUDIO_CLIP { startMs, endMs, format, useVad, preRollMs, postRollMs }`.
5. El offscreen decodifica el WebM al `OfflineAudioContext` a 16 kHz mono PCM (`audio-encoder.ts::decodeToMonoPcm`).
6. Si `useVad`, se ajusta la ventana al envoltorio de habla detectado (`vad.ts::tightenToSpeech`).
7. Se encodea como **WAV/RIFF** mono 16 kHz (`audio-encoder.ts::encodeWavMono`) y se devuelve como data URL para AnkiConnect.

Manifest necesita `"offscreen"` permission. El offscreen document se crea on-demand:

```ts
await chrome.offscreen.createDocument({
  url: 'offscreen/offscreen.html',
  reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
  justification: 'Capturar audio de la pestaña y re-rutearlo a los altavoces',
});
```

**WAV vs MP3:** la implementación actual emite WAV PCM 16 kHz mono. Es el formato que mejor consume Whisper.cpp y AnkiConnect lo acepta sin problema. Convertir a MP3 requeriría una dependencia adicional (`lamejs`) que se ha evitado intencionalmente — el WAV ronda los ~32 kB/seg, suficientemente compacto para tarjetas de 2-5 s. Ver `audio-encoder.ts` para el header RIFF escrito a mano.

### 8.3 Voice Activity Detection (VAD)

Implementado en `src/offscreen/vad.ts`. Es **RMS-energy con noise-floor adaptativo** — sin dependencias externas, ~7 kB, suficiente para diálogo doblado en streaming.

Constantes hand-tuned (todas exportadas):

| Constante | Valor | Para qué |
|---|---|---|
| `FRAME_MS` | 20 | Tamaño de frame del análisis RMS. |
| `SMOOTH_WINDOW` | 5 | Frames de suavizado (mediana) para evitar chattering. |
| `NOISE_FLOOR_PERCENTILE` | 0.2 | Percentil del RMS sin habla — robusto contra picos. |
| `SPEECH_RATIO` | 2.5 | Frame es speech si RMS > noise · 2.5. |
| `MIN_ABSOLUTE_RMS` | 0.005 | Piso absoluto (~-46 dBFS) — evita falsos positivos en silencio. |
| `MIN_SPEECH_MS` | 120 | Descarta regiones < 120 ms (chasquidos, transientes). |
| `MAX_GAP_MS` | 220 | Fusiona regiones separadas por <220 ms (pausa entre palabras). |

`detectSpeech()` devuelve todas las regiones del buffer; `tightenToSpeech(start, end)` elige la región que solapa la ventana deseada y aplica `preRollMs`/`postRollMs`. Si el VAD no encuentra habla creíble, devuelve la ventana original (`usedVad: false`) — fail-open por diseño.

**Por qué no Silero:** habría añadido ~1 MB de ONNX + un runtime WASM. La detección RMS funciona muy bien para audio de streaming porque ya viene comprimido con normalización de loudness; el ratio 2.5× sobre el noise floor adaptativo es suficiente para alinear cues. Si en el futuro hace falta más precisión (idiomas tonales, background music intensa), añadir Silero detrás de la misma interfaz `tightenToSpeech` es trivial.

---

## 9. Reconocimiento y traducción

### 9.1 Diccionario local

Bundlear un JSON por idioma en `assets/dictionaries/`:

```json
{
  "travel": {
    "phonetic": "/ˈtrævəl/",
    "translations": { "es": "viajar", "fr": "voyager" },
    "level": "A2",
    "definitions": {
      "en": "To go from one place to another, especially over a long distance.",
      "es": "Ir de un lugar a otro, especialmente a larga distancia."
    }
  }
}
```

Top 5000 palabras del idioma objetivo es suficiente para >85% del vocabulario en TV.

### 9.2 MWE Registry

`assets/mwes/{lang}.json` — generado offline desde corpus (PHRASE.com, OpenSubtitles).

Estructura idéntica al `SEGMENT_REGISTRY` del prototipo (`VideoPlayer.tsx:31`).

### 9.3 Traducción dinámica (fallback)

Si la palabra no está en el diccionario local, llamar al servicio configurado por el usuario. Cachear resultado en IndexedDB (`translations_cache`).

```ts
async function translate(text: string, source: string, target: string) {
  const cached = await db.translations.get([text, source, target]);
  if (cached) return cached.value;

  const provider = await store.get('translateProvider');
  const value = await providers[provider].translate(text, source, target);
  await db.translations.put({ key: [text, source, target], value });
  return value;
}
```

### 9.4 TTS

Cadena de fallback real (`src/background/tts.ts`):

1. **`chrome.tts.speak()`** — usa las voces del sistema, sin permiso adicional. Es la opción más rápida y de mejor calidad en macOS/Windows. Solo aplica a *reproducción inmediata* dentro de la extensión.
2. Si `chrome.tts` no está disponible, se pasa por mensaje `OFFSCREEN_TTS_SPEAK` al offscreen (`SpeechSynthesisUtterance` con la voz BCP-47 más cercana).
3. **TTS como archivo de audio adjunto a Anki** (`generateTtsAudio(text, lang)`): cuando el orquestador tiene que rellenar un `FieldSource = 'tts'` y no hay clip de tabCapture disponible, llama al endpoint `/v1/audio/speech` de OpenAI (`model: tts-1`, `voice: alloy`, `response_format: mp3`) reutilizando la `apiKey` que el usuario ya configuró en "IA (premium)". Si la respuesta es exitosa, el MP3 se guarda en Anki vía `storeMediaFile` y el campo recibe un `[sound:archivo.mp3]`. Si OpenAI no está configurado o falla, el campo cae al texto plano con la plantilla `{{tts <lang>:Field}}` para que Anki lo lea con su TTS interno (sin regresión respecto al comportamiento previo).
4. **Costo**: OpenAI `tts-1` cuesta ~USD 0.015 por cada 1000 caracteres. Una palabra promedio (~5 chars) sale a ~USD 0.0000075. Documentado para que el usuario decida activarlo o no.

El offscreen mantiene una promesa pendiente por petición y resuelve en `utterance.onend` / `onerror`. Cualquier petición pendiente se cancela en `stopCapture()` (botón Stop del popup).

### 9.5 ASR on-device — Whisper.cpp WASM

Implementado en `src/offscreen/whisper-asr.ts` como **scaffolding opt-in con URLs configurables por el usuario** (no se descarga modelo ni glue hasta que el usuario active "ASR on-device" en Settings, configure `glueUrl`/`modelUrl` y se invoque `TRANSCRIBE_AUDIO_CLIP`).

Arquitectura:

```
service-worker          offscreen document          CDN configurada por el usuario
─────────────────       ──────────────────          ──────────────────────────────
TRANSCRIBE_AUDIO_CLIP → OFFSCREEN_TRANSCRIBE_CLIP →  whisper.js (factory que expone
                                  │                  globalThis.WhisperModule)
                                  ▼                  ggml-tiny.en.bin
                              cache.add()  →        Cache Storage `kivara-lingo-whisper-v1`
                                  │                  (sobrevive a recargas, no a uninstall)
                                  ▼
                              transcribePcm(samples, sampleRate) ──► texto + segments
```

URLs **no se pinea automáticamente** (cambio post-Bloque 4): los defaults estaban apuntando a `libmain.worker.js` del repo upstream, que es un *Web Worker entry*, no la factory `Module` que `loadModule()` necesita. Hacer `init()` sobre eso fallaba siempre con `"Whisper glue did not expose a compatible Module instance"`. Soluciones aceptables:

1. **Compilar tu propio glue** (recomendado, ver `README.md → ASR`): clonar `ggerganov/whisper.cpp@1.5.4`, `cd examples/whisper.wasm && make`, subir `whisper.js` + `whisper.wasm` + `ggml-tiny.en.bin` a tu propio CDN/bucket y configurar las URLs en `Settings → ASR`.
2. **Usar un fork mantenido por la comunidad** que ya exponga `globalThis.WhisperModule` (p. ej. forks de `whisper.wasm` con un build pre-compilado en GitHub Pages).

Si `AsrSettings.glueUrl` o `AsrSettings.modelUrl` están vacíos, `transcribePcm` rechaza con un error claro y el orquestador omite la pasada ASR (no rompe el resto del pipeline).

Flujo (una vez configurado):

1. `fetchModel()` busca el binario en `caches.open('kivara-lingo-whisper-v1')`. Si no está, hace `fetch` con `mode: 'cors'` y lo guarda con `cache.put`. La primera descarga puede tomar 1-2 minutos en redes lentas.
2. `loadModule()` inyecta `<script src="glueUrl">` (no `import()` para evitar problemas con CSPs estrictos) y espera a que aparezca `globalThis.WhisperModule` o `globalThis.Module`.
3. `transcribePcm(samples, sampleRate, language)` empaqueta el PCM Float32 en el formato esperado por Whisper.cpp (32-bit IEEE 754, mono) y llama al binding.
4. `unloadWhisper()` libera el módulo en `stopCapture()` para no retener ~80 MB de RAM cuando el usuario no está usando ASR.

**Errores transitorios** (red, timeout descarga del modelo) devuelven `{ ok: false, transient: true }` para que el caller pueda reintentar sin invalidar la config.

**Por qué no `transformers.js`:** la librería en sí pesa ~2 MB minified y añade una dependencia grande. El glue oficial de `whisper.cpp` es de ~150 kB y está específicamente optimizado para WASM en navegador. Lo único que perdemos es el high-level API; lo añadimos a mano.

### 9.6 IA (premium) — capa 4 de enriquecimiento contextual

Nueva capa opcional implementada en Bloques 1-3. Vive en `src/background/ai-providers.ts` (adapters) + `src/background/ai-enrich.ts` (cache + debounce + concurrencia).

**Proveedores soportados** (con la misma forma de respuesta `AiEnrichment`):

| Provider | Endpoint | Modelo default sugerido |
|---|---|---|
| OpenAI | `POST https://api.openai.com/v1/chat/completions` (`response_format: { type: 'json_object' }`) | `gpt-4o-mini` |
| Anthropic | `POST https://api.anthropic.com/v1/messages` (`anthropic-version: 2023-06-01`) | `claude-3-5-haiku-latest` |
| Google Gemini | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}` (`responseMimeType: application/json`, `thinkingConfig.thinkingBudget: 0`) | `gemini-2.5-flash` |
| `disabled` | — | — (default; no se hacen requests) |

**Prompt común** (verbatim, lo usan los tres adapters):

> Eres un asistente de aprendizaje de idiomas. Devuelve SOLO JSON con las claves contextualDefinition, synonyms (array<=5), collocations (array<=5), nuancedTranslation, register (formal|neutral|informal|slang|literary), appropriateness. Idioma fuente: {sourceLang}. Idioma nativo: {nativeLang}. Palabra/frase: "{token}". Oración: "{sentence}". Plataforma: {platform}.

**Cache + debounce** (`enrichWithAi`):

- Tabla Dexie `ai_cache` (v2 del schema), clave `${provider}|${sourceLang}|${nativeLang}|${djb2(token+sentence)}`.
- TTL configurable en días (default 30) vía `AiSettings.cacheTtlDays`.
- Debounce hard de 300 ms entre llamadas outbound; las peticiones con la misma clave se coalescen vía un `Map<cacheKey, Promise>`.
- Timeout duro de 5 s por llamada (mismo patrón que `translate-providers.ts`).
- Errores se devuelven como `{ ok: false, error }`; el orquestador los agrega como `warnings` en la tarjeta para que el usuario sepa qué falló sin perder el resto del flujo.

**Feature flags**:

| Flag | Default | Efecto |
|---|---|---|
| `AiSettings.provider !== 'disabled'` + `apiKey` no vacía | `disabled` | Habilita toda la capa. |
| `AiSettings.enrichOnSave` | `false` | Cuando se guarda una tarjeta, llamar al provider y rellenar campos `ai-*`. |
| `AiSettings.enrichOnHover` | `false` | Tercera oleada del `WordPopover` (mostrar sinónimos/colocaciones en vivo). |

**Field sources nuevos** (añadidos al union `FieldSource`):

- `ai-definition`, `ai-synonyms`, `ai-collocations`, `ai-nuance`, `ai-register`. Visibles en `CardsTab` con badge fucsia y descripciones específicas.

**Tokens en `chrome.storage.sync`**: la `apiKey` viaja por el mismo store persistido que `googleToken`/`deeplToken`. Nunca se commitea; el `SettingsTab` muestra un warning rojo si el provider está activo pero la key está vacía.

### 9.7 Popover progresivo — 3 oleadas

Nuevo mensaje `RESOLVE_WORD` (`src/shared/messages.ts` + `protocol.d.ts`) que el SW resuelve secuencialmente y devuelve como array `ResolveWordWave[]`:

1. **Oleada local** (`stage: 'local'`): `lookupDictionary(token, sourceLang)` — instantánea, no requiere red.
2. **Oleada remota** (`stage: 'remote'`): si la oleada local devolvió `null`, se invoca `translateText()` (DeepL/Google/LibreTranslate/offline según settings). Cache hit → ~10 ms; miss → ~200-400 ms.
3. **Oleada IA** (`stage: 'ai'`): solo si `req.includeAi` es true Y `enrichOnHover` está activo Y `provider !== 'disabled'`. ~800-1500 ms con `gpt-4o-mini`.

El `WordPopover.tsx` consume las olas en orden, renderiza skeletons (`animate-pulse`) mientras espera cada una, y aborta la petición con `AbortController` cuando cambia el cue o el hover se pierde. La oleada local se ejecuta también del lado del cliente (no espera al SW) para que el primer paint sea instantáneo.

### 9.8 Estado de los Bloques 1-4 (post-implementación)

| Bloque | Status | Notas |
|---|---|---|
| 1 — AI enrichment provider + cache + onboarding | ✔ | OpenAI/Anthropic/Gemini con prompt compartido, cache TTL configurable, paso opcional en el wizard. |
| 2 — Popover progresivo de 3 oleadas | ✔ | Skeletons + `AbortController`. La "streaming" se hace via un solo round-trip por simplicidad (waves[]). |
| 3 — TTS como archivo adjunto | ✔ | OpenAI `tts-1` reusando la `apiKey` del provider IA. Fallback a `{{tts}}` template si no hay provider. |
| 4 — Whisper glueUrl + docs | ✔ | Defaults vacíos; el usuario debe configurar las URLs. Documentado en este archivo y en `README.md → ASR`. |

---

## 10. Tokenización y MWE

Reusar `tokenizeSentence` del prototipo (`VideoPlayer.tsx:79`). Pasarlo a `src/content/nlp/tokenize.ts`.

Mejoras para producción:

1. Usar `Intl.Segmenter` con `granularity: 'word'` — necesario para japonés, chino, tailandés.
2. Cargar el MWE registry asincrónicamente y memoizarlo.
3. Soportar `expanded` set persistido por sesión (no global).

Las interacciones del prototipo se mapean 1:1:

| Interacción | Implementación real |
|---|---|
| Hover sobre token | `onMouseEnter` con debounce 80ms para evitar flicker. |
| Scroll abajo sobre MWE | `WheelEvent` con `preventDefault()`. Añadir `tok.key` a `expandedMWEs`. |
| Scroll arriba sobre palabra hija | Quitar el padre de `expandedMWEs`. |
| `Alt` sobre palabra | Ya implementado con `hoveredKeyRef`. Mantener. |
| Clic en "Guardar" | `bridge.sendMessage('CREATE_CARD', ...)` al SW. |

---

## 11. Integración con Anki (AnkiConnect)

### 11.1 Cliente

```ts
// src/background/anki-connect.ts
const URL = 'http://127.0.0.1:8765';

async function invoke<T>(action: string, params: object = {}): Promise<T> {
  const res = await fetch(URL, {
    method: 'POST',
    body: JSON.stringify({ action, version: 6, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

export const anki = {
  ping: () => invoke<string[]>('deckNames'),
  decks: () => invoke<string[]>('deckNames'),
  models: () => invoke<string[]>('modelNames'),
  fields: (modelName: string) => invoke<string[]>('modelFieldNames', { modelName }),
  addNote: (note: AnkiNote) => invoke<number>('addNote', { note }),
  storeMediaFile: (filename: string, dataB64: string) =>
    invoke<string>('storeMediaFile', { filename, data: dataB64 }),
};
```

### 11.2 Construcción del payload

A partir del `AnkiMapping` configurado por el usuario (mismo tipo que el prototipo, `types.ts:22`):

```ts
async function buildNote(ctx: CaptureContext, mapping: AnkiMapping): Promise<AnkiNote> {
  const fields: Record<string, string> = {};
  for (const [fieldName, source] of Object.entries(mapping.fieldSources)) {
    fields[fieldName] = await resolveField(source, ctx);
  }
  return {
    deckName: mapping.deckName,
    modelName: mapping.modelName,
    fields,
    options: { allowDuplicate: false },
    tags: ['kivara-lingo', ctx.platform, ctx.language],
  };
}
```

`resolveField` mapea cada `FieldSource` a su valor:

| FieldSource | Cómo se resuelve |
|---|---|
| `selection` | El token que el usuario hizo clic. |
| `cue` | Texto completo del cue de subtítulo. |
| `dictionary` | Definición monolingüe del diccionario local. |
| `translate` | Traducción al idioma nativo del usuario. |
| `frame` | `<img src="kivara_<noteId>_frame.jpg">` después de `storeMediaFile`. |
| `tabCapture` | `[sound:kivara_<noteId>_audio.mp3]` después de `storeMediaFile`. |
| `tts` | `[sound:kivara_<token>_tts.mp3]` (TTS de la palabra sola). |
| `manual` | Vacío, el usuario lo edita en Anki. |

### 11.3 Errores comunes

- **AnkiConnect no responde**: detectar timeout (3s) y mostrar al usuario "abre Anki para sincronizar". Encolar en IndexedDB y reintentar.
- **Modelo no existe**: ofrecer "crear modelo Kivara Lingo" — usar `createModel` action.
- **Duplicados**: `allowDuplicate: false`. Si Anki rechaza, mostrar "ya tienes esta tarjeta".

---

## 12. Modelo de datos y persistencia

### 12.1 Zustand store (persistido en `chrome.storage.sync`)

```ts
// src/shared/store.ts
export interface KivaraStore {
  enabled: boolean;
  panelOpen: boolean;
  isPopupMode: boolean;
  isDarkMode: boolean;
  mode: 'learning' | 'reading';
  subtitleStyles: SubtitleStyles;     // mismo tipo que prototipo
  ankiMapping: AnkiMapping;
  captureSettings: {
    autoMode: boolean;
    audioSource: 'tab' | 'mic';
    frameMoment: 'start' | 'center' | 'end';
    endDetect: 'vad' | 'cue';
    bufferSize: number;
    preRoll: number;
    postRoll: number;
    cueMerge: number;
  };
  cleanup: { hideUI: boolean; hideShadows: boolean };
  shortcuts: Record<string, string>;
  translateProvider: 'libretranslate' | 'deepl' | 'google' | 'none';
  translateApiKey: string;             // cifrado con WebCrypto
  knownWords: Set<string>;             // localmente — IndexedDB
  savedTokens: Set<string>;            // hash de notas creadas para deduplicar UI
}
```

### 12.2 Modo de fallo de `chrome.storage.sync`

Una escritura puede fallar (cuota de 8 KB por ítem, sync desactivado o
sesión cerrada). Cuando ocurre:

- El blob queda en un **fallback write-through** en memoria: la sesión sigue
  funcionando y la UI no "vuelve atrás".
- `store.ts` marca el fallo y notifica a los suscriptores
  (`getSyncWriteFailed` / `subscribeSyncWriteError`). Lo consume
  `SyncWriteErrorBanner` (popup y Settings), con reintento vía
  `retrySyncWrite`. No es un campo del store: `setItem` corre dentro de una
  escritura del middleware y escribirlo ahí crearía un bucle.
- Los **ecos propios** se reconocen por identidad, no por contenido: cada
  blob lleva `_w: <contextId>:<seq>` (se elimina al leer). El blob de ajustes
  es determinista sin los secretos, así que comparar por contenido confundía
  "otra contexto guardó lo mismo" con "mi propio eco".
- **Sin cambios no hay escritura**: si el contenido sellado es idéntico al
  último que envió este contexto, `setItem` sale sin tocar
  `chrome.storage.sync`. `panelOpen` / `isPopupMode` / `audioCaptureActive`
  están fuera de `partialize`, así que abrir el panel reserializaba el MISMO
  json — y con un `_w` nuevo eso disparaba `onChanged` en cada pestaña, el
  popup y el SW, con un rehidratado y descifrado completo por contexto contra
  el límite de 120 escrituras/min. Si el envío falla, el guardia se descarta
  (si nadie lo ha reemplazado mientras tanto): el siguiente guardado, aunque
  sea idéntico, reintenta solo.
- **Pendientes reales**: `pendingUnsynced` guarda los blobs que NO llegaron a
  sync. No es lo mismo que "el fallback no está vacío" — el fallback también
  contiene escrituras correctas, y un `removeItem` fallido no deja nada
  pendiente — así que solo esa lista justifica el aviso de cambios
  reemplazados.
- **Avisos** (`storage.syncWriteFailed` / `storage.syncDiscarded`): la
  escritura fallida es reintentable; si un cambio remoto consume un blob
  pendiente, la UI avisa que los cambios locales sin sincronizar se
  reemplazaron (con ✕ para descartarlo), en lugar de dejar desaparecer el
  aviso como si se hubiera arreglado.
- `removeItem` borra también el fallback, el anillo y el guardia de no-op.
- El reintento del banner reenvía el blob **tal cual** por
  `chrome.storage.sync.set`, sin volver a sellarlo: un segundo sellado
  comparaba los campos de secreto ya en blanco contra los baselines reales y
  escribía una tumba por slot, borrando todas las claves.

### 12.3 IndexedDB (Dexie)

```ts
// src/shared/db.ts
export const db = new Dexie('kivara-lingo');
db.version(1).stores({
  translations: '[text+source+target], updatedAt',
  audioCache: 'cueId, blob, createdAt',
  notes: '++id, noteId, deckName, createdAt',
  knownWords: '[word+lang]',
});
```

---

## 13. UI: del prototipo a la realidad

| Componente del prototipo | Destino en la extensión |
|---|---|
| `App.tsx` (navbar mock) | **Eliminar.** El navegador real es la pestaña. |
| `VideoPlayer.tsx` | El video viene de la plataforma. Reusar **solo** la lógica de subtítulo overlay (líneas que renderizan tokens, popover, scroll handler). Pasar a `content/ui/SubtitleOverlay.tsx`. |
| `WordPopover` (interno de VideoPlayer) | Extraer a `content/ui/WordPopover.tsx`. |
| `ExtensionPanel.tsx` | `content/ui/SidePanel.tsx` (mismo layout, mismas tabs). |
| `SubtitlesTab.tsx` | Idem. Estilos guardados van al store, propagados al overlay. |
| `CardsTab.tsx` | Idem. La conexión AnkiConnect ahora es real (no mock). |
| `SettingsTab.tsx` | Idem. Captura settings ahora controlan el orquestador real. |
| `KivaraLingoLogo.tsx` | Reusar tal cual en SidePanel y popup. |
| `Toaster` (sonner) | Reusar dentro del shadow. |

**Estilos:** copiar `src/styles/theme.css` tal cual. Las clases `sl-input`, `sl-select`, `sl-range` son críticas y deben funcionar dentro del Shadow DOM (Tailwind v4 con `@layer base` se preserva).

**Modo Lectura:** activar el flag `mode === 'reading'` ya implementado. Oculta popovers y deja solo el subtítulo estilizado.

---

## 14. Atajos de teclado

Definidos en `manifest.json > commands`. El service worker los recibe vía `chrome.commands.onCommand`:

```ts
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  bridge.sendMessage(command, {}, `content-script@${tab.id}`);
});
```

El content script reacciona al mensaje y dispara la acción local (guardar la palabra bajo el cursor, repetir cue, etc).

---

## 15. Permisos, privacidad y seguridad

1. **Datos del usuario**: nunca salen del navegador excepto cuando el usuario configura un servicio externo (traducción / TTS premium). Esto debe estar **explícitamente declarado en la página de Options** y en la store listing.
2. **Audio capturado**: nunca persistir más allá del cue actual. Borrar buffer rolling al cambiar de pestaña/video.
3. **Claves API**: cifrar con `crypto.subtle` antes de guardar. Clave derivada de un secret bundleado + fingerprint de la instalación.
4. **AnkiConnect**: solo acepta conexiones de localhost. Pero un sitio malicioso podría abusar si la extensión expone wrappers. **No exponer ningún wrapper a `window`**.
5. **Content Security Policy**: MV3 obliga a `'self'` para scripts. No `eval`, no `new Function`.
6. **DRM**: respetar. No intentar capturar frames de video DRM-protected si el navegador lo bloquea.

---

## 16. Performance y límites

| Métrica | Objetivo |
|---|---|
| Tiempo de inyección al cargar página | <200ms |
| Latencia hover → popover visible | <100ms |
| Latencia clic → tarjeta en Anki | <2s (incluyendo audio + frame) |
| Memoria del content script | <50MB |
| Tamaño del bundle (zip publicado) | <5MB sin diccionarios bundleados, <15MB con uno |
| FPS del video con overlay activo | ≥ 60 (no degradar) |

**Optimizaciones obligatorias:**

- Lazy load de tabs del panel (Cards/Settings solo al abrir).
- Memoizar `tokenizeSentence` por cue.
- `IntersectionObserver` para no renderizar el panel cuando está oculto.
- Throttle de `onCueChange` a 30 Hz máximo.

---

## 17. Testing

| Capa | Tooling | Qué probar |
|---|---|---|
| Unit | Vitest + Testing Library | tokenizer, dictionary lookup, AnkiConnect client (con `msw` para mockear `fetch`). |
| Integración | Vitest + jsdom + `webextension-mock-browser` | flujos de mensajería content↔SW. |
| E2E | **Playwright** con extensión cargada | sobre páginas estáticas que simulen Netflix/YouTube (no contra producción para no violar TOS). |
| Manual | checklist por plataforma | hover, scroll, Alt, guardar, cambiar tema, dock/popup. |

Los tres checks manuales que más se repetían en las revisiones ya están
automatizados en `tests/e2e/manual-verification.spec.ts` (correr con
`pnpm build && npx playwright test tests/e2e/manual-verification.spec.ts`):

1. **sync inservible** (cuota llena / sesión cerrada): guardar una clave,
   mover un slider, recargar → la clave sigue ahí y el aviso apareció.
2. **Anki en un puerto propio** (`18765`, servidor de prueba local) con el
   service worker idle más de 30 s → sin errores de CORS ni de red.
3. **dos pestañas**: «Quitar» en una y un cambio de ajuste en la otra → la
   clave sigue borrada.

Las aserciones de texto aceptan es y en: el Chromium del runner y el Chrome
del desarrollador pueden reportar idiomas distintos a `chrome.i18n`.

---

## 18. Build, empaquetado y publicación

### 18.1 Vite config (resumen)

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' assert { type: 'json' };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: { rollupOptions: { input: { /* popup, options, offscreen */ } } },
});
```

### 18.2 Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "vitest",
    "e2e": "playwright test",
    "package:chrome": "vite build && cd dist && zip -r ../kivara-lingo-chrome.zip .",
    "package:firefox": "vite build && web-ext build --source-dir=dist --artifacts-dir=web-ext-artifacts"
  }
}
```

### 18.3 Distribución

- **Chrome Web Store**: cuenta de developer ($5 one-time). Subir zip producido por `package:chrome`. Review típico: 1-3 días.
- **Firefox Add-ons (AMO)**: gratis. `web-ext sign` firma automáticamente.
- **Edge Add-ons**: gratis, acepta el mismo zip de Chrome.

---

## 19. Roadmap por fases

### Fase 1 — MVP (4 semanas)
- Manifest V3 + content script + service worker base.
- Adapter para **YouTube** únicamente (más fácil: `<video>.textTracks`).
- Subtitle overlay con tokenización.
- Diccionario inglés bundled (top 5000).
- Hover popover + clic guardar (sin audio, sin frame).
- AnkiConnect: `addNote` con `cue + selection + translation`.
- Settings básico: estilos de subtítulo + tema.

### Fase 2 — Captura completa (3 semanas)
- Captura de audio del cue (offscreen + MediaRecorder).
- Captura de frame (canvas + offscreen).
- Modo Auto vs Manual.
- VAD para alineación.
- Atajos de teclado.

### Fase 3 — Plataformas (4 semanas)
- Netflix adapter (más complejo: interceptar fetch).
- HBO Max / Max.
- Disney+, Prime Video.
- Modo Lectura.

### Fase 4 — Pulido (2 semanas)
- Diccionarios para 5 idiomas más.
- Traducción dinámica (LibreTranslate self-host + DeepL).
- Deduplicación inteligente.
- Página de Options completa.
- Onboarding al primer uso.

### Fase 5 — Lanzamiento
- Beta cerrada (50 usuarios).
- Web Store listings.
- Landing en kivara.app/lingo.

---

## 19.1 Estado de Fase 3 (post-MVP de la AI anterior)

La AI anterior dejó cuatro entregas diferidas. Estado actualizado:

| Entrega diferida | Estado | Archivos |
|---|---|---|
| **Whisper.cpp WASM completo** | ✅ Wired (scaffolding opt-in, CDN-hosted, IndexedDB cache) | `src/offscreen/whisper-asr.ts`, `src/background/audio-capture-manager.ts::transcribeAudioClip`, `src/background/service-worker.ts::TRANSCRIBE_AUDIO_CLIP` |
| **VAD real** | ✅ Implementado (RMS + noise floor adaptativo, hand-tuned) | `src/offscreen/vad.ts`, integrado en `audio-processor.ts::extractClip` |
| **Conversión a MP3** | ⚠️ Sustituido por **WAV PCM 16 kHz mono** (sin nuevas deps) | `src/offscreen/audio-encoder.ts` |
| **Fallback TTS por SpeechSynthesis** | ✅ Implementado (chrome.tts → offscreen SpeechSynthesis) | `src/offscreen/tts-fallback.ts`, `src/background/tts.ts::speak` |

**Sobre la sustitución MP3 → WAV:** la decisión de no introducir `lamejs` (~75 kB minified) viene del requisito "sin dependencias nuevas". WAV PCM 16 kHz mono:

- Es lo que Whisper espera — evita una doble conversión.
- AnkiConnect acepta `wav` igual que `mp3` (`storeMediaFile` no impone formato).
- 32 kB/segundo · 3s típicos por cue = ~96 kB por tarjeta. Para una colección de 5000 tarjetas, ~480 MB — aceptable.
- Si el usuario necesita MP3 más adelante, basta con añadir `lamejs` y un `encodeMp3Mono` al lado de `encodeWavMono` con la misma firma.

**Cambios estructurales que habilitan la Fase 3:**

- `offscreen/audio-processor.ts` reescrito para multiplexar tres consumidores del offscreen document: rolling-buffer (USER_MEDIA), TTS playback (AUDIO_PLAYBACK), ASR (compute). Refcount en `audio-capture-manager.ts` para no cerrar el offscreen mientras una transcripción sigue corriendo.
- Nueva ruta `TRANSCRIBE_AUDIO_CLIP` (content/popup → SW → offscreen) en `messages.ts` + `protocol.d.ts` + service worker handler.
- `capture-orchestrator.ts` ahora respeta `captureSettings.preRoll`, `postRoll` y `endDetect` (`vad` | `cue`) en todas las invocaciones, incluyendo el reintento de notas pendientes.
- `extForMime` actualizado para devolver `wav` cuando el offscreen entrega audio en ese formato.

**Pendiente para fases futuras:**

- Modelos Whisper más grandes (`base`, `small`) — requeriría UI de progreso de descarga (los `tiny` se bajan en silencio).
- Tono / pitch shifting del TTS premium (no relevante para la cadena chrome.tts → SpeechSynthesis actual).
- Generación de MP3 si el usuario lo activa explícitamente (decisión pendiente vs mantener el "sin dependencias nuevas").

---

## 20. Glosario

- **Cue**: una entrada de subtítulo (un `<p>` en TTML o un bloque WebVTT) — un texto con `start` y `end` en segundos.
- **MWE**: Multi-Word Expression. Expresión de varias palabras con significado idiomático (`these days`, `kick the bucket`).
- **VAD**: Voice Activity Detection. Detectar dónde hay habla en un buffer de audio.
- **AnkiConnect**: addon de Anki que expone una API HTTP en `localhost:8765`.
- **Note type / Modelo**: plantilla de tarjeta en Anki, define qué campos tiene.
- **TTML / WebVTT**: formatos de subtítulos. TTML es XML (Netflix, Prime); WebVTT es texto plano (YouTube, HTML5 estándar).
- **MAIN world / ISOLATED world**: contextos JS de un content script. ISOLATED no comparte `window` con la página; MAIN sí.
- **Shadow DOM**: árbol DOM aislado. Los estilos de la página no afectan el contenido del shadow, ni viceversa.

---

**Última actualización:** 2026-05-14 · **Versión del prototipo de referencia:** 0.1.0
