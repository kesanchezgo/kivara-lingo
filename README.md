# Kivara Lingo

> Aprende idiomas mientras ves tu serie favorita. Subtítulos personalizables, transcripción navegable, controles de estudio, estado de palabras y nivel, popover enriquecido con el orquestador de enriquecimiento y tarjetas Anki en un clic con frame y audio exacto de la frase.

**Kivara Lingo** es una extensión Chrome real (Manifest V3) que se monta sobre reproductores de streaming (Netflix, HBO Max, Disney+, YouTube, Prime Video) y convierte sus subtítulos en una herramienta de aprendizaje de vocabulario integrada con Anki. Al pasar el ratón sobre una palabra o expresión multi-palabra obtienes fonética, traducción, sinónimos, antónimos, colocaciones, etimología e imágenes; con un clic generas una tarjeta Anki con el audio exacto de la frase y el fotograma del momento (las imágenes web quedan como fallback).

> **Nota:** la extensión real vive en `src/` y se construye con `pnpm build`. La carpeta `.mock/` está ignorada por git y solo existe como referencia local de diseño; el motor es el del repo.

---

## Novedades de la v2 (0.3.0)

La v2 sustituye la capa de vista y añade motores nuevos sin reescribir la captura, el enriquecimiento ni Anki. Lo que hay hoy en `src/`:

- **Overlay rediseñado** sobre el tokenizador real: modos de traducción (visible, difuminada, oculta), Escucha primero, pausa al consultar, modo Lectura, navegación por teclado (←/→, Home/End, Shift para seleccionar) y marcas de estado de palabra en el subrayado.
- **Tarjeta de palabra** montada sobre `useResolveWord`: estados de esqueleto/fases y selector de estado (nueva, aprendiendo, conocida) con su nivel.
- **Transcripción lateral**: pestañas Frases · Palabras, búsqueda, seguimiento del cue activo (solo lo apaga un gesto del usuario), filtro i+1 y salto por línea sin tocar `video.currentTime` en Netflix.
- **Controles de estudio**: barra propia de Kivara con anterior, repetir lento (pulsación larga = más lento), siguiente, auto-pausa, bucle y velocidad; 9 atajos de página nuevos además de los 5 del manifest.
- **Estado de palabras y nivel**: estimador de vocabulario sobre la lista de frecuencias, prueba de vocabulario con pseudopalabras, `LevelLadder` y pestaña Vocabulario. Se guarda por idioma en `chrome.storage.local`.
- **Tarjetas v2**: tipos de tarjeta, etiquetas `kivara::lang::<idioma>`, `kivara::<serie>::<episodio>` y `kivara::<tipo>` (más `kivara-lingo` por compatibilidad), mazo por idioma, Recientes, Deshacer, Añadir esta escena y Ver en Anki. El registro y la cola tienen un único escritor: el service worker.
- **Explicar frase (IA)**: `AI_EXPLAIN_SENTENCE` con `callAiJson`, caché en Dexie y proveedor `openai-compatible` con endpoints curados (OpenRouter, Groq, DeepSeek, Mistral, Together, xAI y localhost para Ollama/LM Studio). Solo aparece con la IA configurada.
- **Onboarding v2** de 8 pasos, con el paso Nivel entre Idioma y Anki y el mapeo con el mazo del idioma elegido.
- **Panel, Options y Popup** con el sistema de diseño nuevo sin Radix (Select y Slider nativos, diálogo con trampa de foco propia) y store v3.

---

## Características principales

- **Subtítulos personalizables**: tamaño, color, peso, sombra, fondo, opacidad y posición (arriba / medio / abajo).
- **Tokenización inteligente con MWE**: detecta expresiones multi-palabra (*these days*, *kick the bucket*, *look up*) usando un índice de 13 501 frases de Wiktionary + lematización de inflexiones (*kicked the bucket* → *kick the bucket*).
- **Popover con resolución en streaming**: la información esencial aparece en < 1 s (datos locales + traducción); el resto llega en fases mientras ves la serie. Un footer "buscando más…" indica que el enriquecimiento sigue en curso.
- **Enriquecimiento multi-fuente**: fuentes Standard de red (siempre activas, sin clave) + fuentes VIP (toggle, BYOK donde aplica) + capa de IA opcional. Palabra polisémica resuelta por acepción de la frase (`run` empresa → `dirigir`, no `correr`).
- **Tarjetas Anki en un clic**: vía AnkiConnect, con mapeo configurable de campos. Incluye el audio exacto de la frase (ring buffer + VAD, fallback TTS avisado) y el mejor fotograma del cue (con fallback a imagen web). `Alt+V` re-captura el frame.
- **Caché inteligente**: LRU en memoria (300 entradas) + IndexedDB con TTL configurable. Re-hover = ~0 ms.
- **Modo Lectura**: oculta toda la UI de aprendizaje y deja solo subtítulos estilizados.
- **Atajos de teclado**: `Ctrl+Shift+S` guardar, `Alt+C` toggle subtítulos, `Alt+R` repetir frase, `Alt+V` re-capturar frame, `Alt+K` toggle panel. Combos de página personalizables en Settings (los comandos Chrome se re-asignan en `chrome://extensions/shortcuts`).
- **Tema claro y oscuro**, panel acoplado o flotante.
- **UI bilingüe ES/EN**: diccionarios en `src/shared/i18n/` (un archivo por área) con claves ES/EN pareadas; el idioma se detecta vía `chrome.i18n.getUILanguage()` con fallback a español.

---

## Cómo construir

```bash
# Instalar dependencias
pnpm install

# Puerta completa
pnpm test         # vitest (unidad e integración)
pnpm typecheck    # tsc, proyectos app y node
pnpm lint         # eslint con tope de 24 avisos
pnpm build        # build de producción → dist/
pnpm test:e2e     # build + Playwright sobre Chromium real (incluye axe)

# Build del diccionario bundled (si modificas data/)
pnpm dict:build
```

El build usa **Vite + `@crxjs/vite-plugin`** y produce la carpeta `dist/` lista para cargar en Chrome.

---

## Cómo cargar la extensión

1. Abre `chrome://extensions` en Chrome.
2. Activa **Modo desarrollador** (esquina superior derecha).
3. Haz clic en **Cargar descomprimida** y selecciona la carpeta `dist/`.
4. La extensión aparece en la barra de herramientas. Navega a YouTube, Netflix, etc.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Pestaña del navegador (Netflix, YouTube, …)                │
│                                                             │
│  Content Script (src/content/)                              │
│  ├── platform-adapters/   detecta plataforma, extrae cues   │
│  ├── nlp/                 tokenizador, MWE, lematización    │
│  └── ui/  (Shadow DOM)    SubtitleOverlay, WordPopover,     │
│                           SidePanel, LoadingCard skeleton   │
└──────────────────────────┬──────────────────────────────────┘
                           │ chrome.runtime (port kvl-resolve-word)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Service Worker (src/background/)                           │
│  ├── resolve-word.ts      fases: local→translation→         │
│  │                        enrichment→ai→done (streaming)    │
│  ├── enrichment/          orquestador de fuentes                   │
│  ├── translate-providers  MyMemory ∥ Lingva (raced)         │
│  ├── anki-connect.ts      proxy CORS-free a AnkiConnect     │
│  ├── ai-providers.ts      OpenAI / Anthropic / Gemini       │
│  └── cache-admin.ts       getCacheStats / clearCaches       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Offscreen Document (src/offscreen/)                        │
│  ├── audio-processor.ts   tabCapture → WAV 16 kHz mono      │
│  ├── audio-encoder.ts     PCM → RIFF WAV                    │
│  └── vad.ts               RMS energy VAD (sin dependencias) │
└─────────────────────────────────────────────────────────────┘
```

### Resolución en streaming (port `kvl-resolve-word`)

El content script abre un puerto al service worker y recibe fases a medida que están listas:

| Fase | Contenido | Latencia típica |
|---|---|---|
| `local` | datos bundled + Yomitan packs | < 1 ms |
| `translation` | traducción (MyMemory ∥ Lingva) | ~200–500 ms |
| `enrichment` | orquestador fan-out | ~300–2000 ms |
| `ai` | mnemónico, etimología, registro | ~1–3 s (si activo) |
| `done` | señal de fin | — |

La traducción y el enriquecimiento se lanzan en paralelo (`Promise.allSettled`), por lo que el tiempo total es `max(t_translation, t_enrichment)`, no la suma.

---

## Niveles de enriquecimiento

### Local (siempre activo, < 1 ms)

Datos bundled que viajan con la extensión (chunk dictionary ~2.3 MB tras el trim 2026-10-07; WordNet por shards bajo demanda):

| Asset | Entradas | Qué aporta |
|---|---:|---|
| `en.json` | 4 151 | Traducción, bilingüe, monolingüe, IPA, nivel, ejemplos |
| `en-extensions.json` | 362 | Phrasals, idioms, cognados |
| `en-cefr.json` | 4 950 | Nivel CEFR (A2–C2) |
| `en-idioms.json` | 1 617 | Idioms NTC (el `_note` del archivo es metadatos, no una entrada; medido 2026-10-13) |
| `en.json` (MWEs) | 150 | MWEs curados |
| `en-phrasal-academic.json` | 673 | Oxford Phrasal Academic Lexicon |
| `academic-collocation-list.json` | 472 | Colocaciones académicas |
| `en-thesaurus.json` | 611 | Sinónimos + antónimos (Fernald 1896) |
| `en-mwe-index.json` | 13 501 | Índice de frases Wiktionary (idioms + phrasals + proverbs) |
| Curado propio | 7 verbos | Pares verbo-objeto offline (`run fast`, `forget your keys`, `know the answer`…) |

### Standard (siempre activo, sin clave)

Free Dictionary API · Datamuse · Wiktionary REST · **Wiktionary HTML** (etimología + sinónimos + antónimos + términos relacionados, con fallback phrasal) · WiktionaryAPI (freedictionaryapi.com) · WiktAPI · Moby Thesaurus · **Thesaurus.com** (antónimos para sustantivos técnicos/abstractos) · **WordHippo** (antónimos para MWEs/phrasals/idioms) · **The Idioms** (etimología de idioms) · Etymonline · Tatoeba · Lingua Libre · Google TTS (solo la palabra) · Bing Images · Openverse · Wikimedia Commons · DuckDuckGo Images · YouGlish · Bundled · Yomitan packs · WordNet

> El número exacto de fuentes vive en `SOURCE_TIERS` (`src/background/enrichment/source-tiers.ts`), no en este párrafo: MyMemory y Lingva son traductores, no fuentes de enriquecimiento, y Britannica Dictionary es editorial con gate VIP.

**Cobertura medida (corpus 15 tokens × 2 tiers, 30 tarjetas, 0 errores, 2026-10-07):** Standard traducción/definición/ejemplos 15/15, IPA 13/15 (15/15 con packs), syn 9/15, coll 7/15; VIP syn 10/15, coll 8/15, ant 7/15. Vacío controlado donde toca (slang, determinantes, técnico sin antónimo). Ver `docs/reports/final-quality/enrichment-final-2026-10-07.md`.

### VIP (toggle en Settings; BYOK donde se indica)

Cambridge · Oxford Learner's · Longman · Dictionary.com (reemplaza al toggle legacy `collins`) · Merriam-Webster · Merriam-Webster Thesaurus · Ozdic (Oxford Collocations) · PONS · bab.la · dict.cc · Reverso · Linguee · PROMT.One Contexts · WordReference · SpanishDict · Forvo · **Britannica Dictionary** (editorial) · **Unsplash (BYOK)** · **Pixabay (BYOK opcional)**

> Nota: el toggle `oxfordCollocations` es un pack local (no fuente de red) y hoy resuelve a `null` — queda como reserva para un futuro pack dedicado.

**Cobertura medida (mismo corpus):** VIP traducción/definición/ejemplos 15/15, IPA 13/15 (15/15 con packs), syn 10/15, coll 8/15, ant 7/15. Ver `docs/reports/final-quality/enrichment-final-2026-10-07.md`.

### IA (opcional, BYOK)

OpenAI / Anthropic / Google Gemini — genera definición contextual, sinónimos, colocaciones, registro, mnemónico, etimología y (solo OpenAI, opt-in) imagen DALL-E 3 (~$0.04/tarjeta).

| Provider | Modelo sugerido |
|---|---|
| OpenAI | `gpt-4o-mini` |
| Anthropic | `claude-haiku-4-5` |
| Google Gemini | `gemini-2.5-flash` (default) |

---

## Configuración

### VIP y claves BYOK

Abre el panel → **Settings → Enriquecimiento (VIP)**:

- Activa el master toggle para habilitar las fuentes VIP.
- Cada fuente tiene su propio checkbox.
- **Unsplash**: requiere clave gratuita de [unsplash.com/developers](https://unsplash.com/developers) (50 req/h Demo).
- **Pixabay**: clave opcional de [pixabay.com/api/docs](https://pixabay.com/api/docs) (100 req/min). Sin clave usa scraping.

Las claves se almacenan cifradas (AES-GCM) en `chrome.storage.local` (slots `kivara-secret:v1:*`).

### IA

**Settings → IA (premium)**: pega tu API key, elige modelo, activa *Enriquecer al guardar* y/o *Enriquecer al pasar el ratón*.

Flags adicionales:
- `preferAiMnemonic` / `preferAiEtymology`: cuando están desactivados, Etymonline / bundled gana sobre el LLM.
- `enableDalleFallback`: opt-in explícito para generación de imágenes con DALL-E 3 (solo OpenAI).

### Gestión de caché

**Settings → Enriquecimiento → Limpiar caché**: muestra estadísticas por bucket (enrichment, translation, AI, media) con número de filas y tamaño aproximado. El botón de limpieza pide confirmación y explica qué se borra.

### Anki

**Settings → Cards**: configura el deck, note type y mapeo de campos. Fuentes disponibles: `selection`, `cue`, `phonetic`, `translation`, `bilingual`, `monolingual`, `examples`, `synonyms`, `antonyms`, `collocations`, `etymology`, `mnemonic`, `image`, `frame`, `sentence-audio`, `word-audio`, `video-link`, `ai-*`.

---

## Packs Yomitan (descargables)

Cinco packs curados en un bucket Cloudflare R2, instalables desde **Settings → Diccionarios offline** (también en el onboarding):

| Pack | Tamaño | Cobertura |
|---|---|---|
| `kty-en-es.zip` | 1.5 MB | EN→ES bilingüe (~61k términos, conteo real del ZIP) |
| `kty-es-en.zip` | 22 MB | ES→EN bilingüe |
| `kty-en-en.zip` | 127 MB | EN→EN monolingüe (~500k entradas, solo galería premium) |
| `kty-es-es.zip` | 38 MB | ES→ES monolingüe |
| `kty-en-ipa.zip` | 5 MB | IPA pronunciación EN (~140k filas, conteo real) |

El onboarding instala automáticamente `kty-en-es` + `kty-en-ipa`. Efecto medido: IPA 13→15/15 en ambos tiers + traducción más rica + offline <1 ms. No aportan syn/ant/coll (el pack no los trae).

---

## ASR on-device

Retirado (issue #30). Una ruta completa de transcripción local con `whisper.cpp` era inalcanzable por construcción: el glue vivía en una URL remota y MV3 aplica `script-src 'self'` a las páginas de extensión, y `Settings → ASR` ya no existe. Ver `IMPLEMENTATION.md §9.5`.

---

## Convertir audio a flashcard

La ruta de audio sí está completa y es el valor que ya se usa hoy: captura de pestaña (AudioWorklet con fallback a `ScriptProcessor`), ventana de muestreo resampleada una sola vez, recorte por VAD y salida MP3 o WAV 16 kHz mono para Anki.

---

## Plataformas soportadas

| Plataforma | Estrategia de subtítulos |
|---|---|
| YouTube | Bus interceptado de `/api/timedtext` primero (incluida la pista traducida auto-fetch con `tlang`), luego `<video>.textTracks`, y como último recurso el DOM de subtítulos de la página |
| Netflix | Intercepta TTML/DFXP de `*.nflxvideo.net` vía `main-world-interceptor.ts` |
| Disney+ | Bus interceptado: segmentos WebVTT + parseo del manifest DASH (MPD) para las pistas alternativas |
| HBO Max / Max | Bus interceptado: segmentos WebVTT + parseo del manifest DASH (MPD) para las pistas alternativas |
| Prime Video | Bus interceptado: TTML/DFXP en los dominios de Amazon (`media-amazon.com`, `primevideo.com`, CloudFront) |

---

## Tests

```bash
pnpm test          # unitarios e integración (vitest)
pnpm typecheck     # TypeScript estricto, dos proyectos
pnpm lint          # 0 errores; el tope de avisos es 24 y solo puede bajar
pnpm build         # dist/ listo para cargar
pnpm test:e2e      # Playwright sobre Chromium real
```

Los tests cubren: tokenizador, MWE, lematización, parsers de fuentes de enriquecimiento, ranking por acepción, cadena de traducción, VAD, encoder WAV, utilidades compartidas y contrato de provenance por campo. Desde F0-F9 se añaden: migración del store v3 y tamaño del blob, `chromeLocalStore`, registro de tarjetas, `PlaybackController`, `AI_EXPLAIN_SENTENCE`, estimador de nivel determinista, claves i18n muertas y una auditoría axe (panel y overlay) en la e2e.

---

## Marca

**Kivara Lingo** es el primer producto de **Kivara**, una marca personal que albergará otras herramientas en el futuro (Kivara Notes, Kivara Read, etc.).

---

## Licencia

MIT para el **código** (ver [LICENSE](LICENSE)). Los datos de terceros que se
distribuyen en el paquete tienen cada uno su licencia:

- **Datos lingüísticos**: WordNet (CC BY 4.0), índice MWE de Wiktionary
  (CC BY-SA 4.0), Oxford, idioms, colocaciones académicas y tesauro.
- **Lista de frecuencias** (`src/assets/frequency/`): derivada de
  FrequencyWords / OpenSubtitles, **CC BY-SA 4.0**; se distribuye offline y
  hereda el ShareAlike.
- **Falsos amigos ES↔EN y banco de la prueba**: listas curadas para esta
  extensión.
- **Inter** (OFL-1.1) y **Phosphor Icons** (MIT): ver
  [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

Al construir desde el repo, esas licencias van contigo en el paquete.
