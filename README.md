# Kivara Lingo

> Aprende idiomas mientras ves tu serie favorita. Subtítulos personalizables, popover enriquecido con 33 fuentes, tarjetas Anki en un clic.

**Kivara Lingo** es una extensión Chrome real (Manifest V3) que se monta sobre reproductores de streaming (Netflix, HBO Max, Disney+, YouTube, Prime Video) y convierte sus subtítulos en una herramienta de aprendizaje de vocabulario integrada con Anki. Al pasar el ratón sobre una palabra o expresión multi-palabra obtienes fonética, traducción, sinónimos, antónimos, colocaciones, etimología e imágenes; con un clic generas una tarjeta Anki con audio del cue y fotograma del momento exacto.

> **Nota:** la carpeta `mock/` contiene el prototipo de UI/UX original en React puro. La extensión real vive en `src/` y se construye con `pnpm build`.

---

## Características principales

- **Subtítulos personalizables**: tamaño, color, peso, sombra, fondo, opacidad y posición (arriba / medio / abajo).
- **Tokenización inteligente con MWE**: detecta expresiones multi-palabra (*these days*, *kick the bucket*, *look up*) usando un índice de 13 501 frases de Wiktionary + lematización de inflexiones (*kicked the bucket* → *kick the bucket*).
- **Popover con resolución en streaming**: la información esencial aparece en < 1 s (datos locales + traducción); el resto llega en fases mientras ves la serie. Un footer "buscando más…" indica que el enriquecimiento sigue en curso.
- **Enriquecimiento multi-fuente**: 20 fuentes Standard (siempre activas, sin clave) + 13 fuentes VIP (toggle) + capa de IA opcional.
- **Tarjetas Anki en un clic**: vía AnkiConnect, con mapeo configurable de campos. Incluye audio de la pestaña (WAV 16 kHz mono) y screenshot del frame.
- **Caché inteligente**: LRU en memoria (300 entradas) + IndexedDB con TTL configurable. Re-hover = ~0 ms.
- **Modo Lectura**: oculta toda la UI de aprendizaje y deja solo subtítulos estilizados.
- **Atajos de teclado**: `Ctrl+S` guardar, `Alt+C` toggle subtítulos, `Alt+R` repetir frase, `Alt+K` toggle panel.
- **Tema claro y oscuro**, panel acoplado o flotante.

---

## Cómo construir

```bash
# Instalar dependencias
pnpm install

# Build de producción → dist/
pnpm build

# Tests (160/160 passing)
pnpm vitest run

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
│  ├── enrichment/          orquestador + 33 fuentes          │
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
| `enrichment` | 20–33 fuentes en paralelo | ~300–2000 ms |
| `ai` | mnemónico, etimología, registro | ~1–3 s (si activo) |
| `done` | señal de fin | — |

La traducción y el enriquecimiento se lanzan en paralelo (`Promise.allSettled`), por lo que el tiempo total es `max(t_translation, t_enrichment)`, no la suma.

---

## Niveles de enriquecimiento

### Local (siempre activo, < 1 ms)

Datos bundled que viajan con la extensión (~2.5 MB raw, ~250 KB gzip):

| Asset | Entradas | Qué aporta |
|---|---:|---|
| `en.json` | 4 151 | Traducción, bilingüe, monolingüe, IPA, nivel, ejemplos |
| `en-extensions.json` | 357 | Phrasals, idioms, cognados |
| `en-cefr.json` | 4 951 | Nivel CEFR (A2–C2) |
| `en-idioms.json` | 14 318 | Idioms NTC con definición + ejemplos (dominio público) |
| `en.json` (MWEs) | 150 | MWEs curados |
| `en-phrasal-academic.json` | 673 | Oxford Phrasal Academic Lexicon |
| `academic-collocation-list.json` | 472 | Colocaciones académicas |
| `en-thesaurus.json` | 611 | Sinónimos + antónimos (Fernald 1896) |
| `en-mwe-index.json` | 13 501 | Índice de frases Wiktionary (idioms + phrasals + proverbs) |

### Standard (20 fuentes, siempre activo, sin clave)

Free Dictionary API · Datamuse · Wiktionary REST · **Wiktionary HTML** (etimología + sinónimos + antónimos + términos relacionados, con fallback phrasal) · WiktionaryAPI (freedictionaryapi.com) · Moby Thesaurus · **Thesaurus.com** (antónimos para sustantivos técnicos/abstractos) · **WordHippo** (antónimos para MWEs/phrasals/idioms) · **The Idioms** (etimología de idioms) · Etymonline · Tatoeba · Lingua Libre · Google TTS · Bing Images · Openverse · Wikimedia Commons · DuckDuckGo Images · YouGlish · MyMemory · Lingva

**Cobertura medida:** 98.6 % en corpus de 20 palabras × 11 campos (fair scoring).

### VIP (13 fuentes, toggle en Settings)

Cambridge · Oxford Learner's · Longman · Collins · Merriam-Webster · Ozdic (Oxford Collocations) · Reverso · Linguee · WordReference · SpanishDict · Forvo · **Unsplash (BYOK)** · **Pixabay (BYOK opcional)**

**Cobertura medida:** 100 % en el mismo corpus.

### IA (opcional, BYOK)

OpenAI / Anthropic / Google Gemini — genera definición contextual, sinónimos, colocaciones, registro, mnemónico, etimología y (solo OpenAI, opt-in) imagen DALL-E 3 (~$0.04/tarjeta).

| Provider | Modelo sugerido |
|---|---|
| OpenAI | `gpt-4o-mini` |
| Anthropic | `claude-3-5-haiku-latest` |
| Google Gemini | `gemini-2.5-flash` (default) |

---

## Configuración

### VIP y claves BYOK

Abre el panel → **Settings → Enriquecimiento (VIP)**:

- Activa el master toggle para habilitar las 13 fuentes VIP.
- Cada fuente tiene su propio checkbox.
- **Unsplash**: requiere clave gratuita de [unsplash.com/developers](https://unsplash.com/developers) (50 req/h Demo).
- **Pixabay**: clave opcional de [pixabay.com/api/docs](https://pixabay.com/api/docs) (100 req/min). Sin clave usa scraping.

Las claves se almacenan cifradas (AES-GCM) en `chrome.storage.sync`.

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

Cinco packs curados en un bucket Cloudflare R2, instalables desde **Settings → Diccionarios offline**:

| Pack | Tamaño | Cobertura |
|---|---|---|
| `kty-en-es.zip` | 1.5 MB | EN→ES bilingüe (~67k entradas) |
| `kty-es-en.zip` | 22 MB | ES→EN bilingüe (~250k entradas) |
| `kty-en-en.zip` | 127 MB | EN→EN monolingüe (~500k entradas) |
| `kty-es-es.zip` | 38 MB | ES→ES monolingüe |
| `kty-en-ipa.zip` | 5 MB | IPA pronunciación EN |

El onboarding instala automáticamente `kty-en-es` + `kty-en-ipa`.

---

## ASR on-device (opt-in)

Scaffolding para Whisper.cpp WASM. No se descarga nada hasta que el usuario active "ASR on-device" en Settings y configure las URLs del glue y el modelo. Ver `IMPLEMENTATION.md §9.5` para instrucciones de compilación.

---

## Plataformas soportadas

| Plataforma | Estrategia de subtítulos |
|---|---|
| YouTube | `<video>.textTracks` (HTML5) |
| Netflix | Intercepta TTML/WebVTT vía `main-world-interceptor.ts` |
| Disney+ | `<video>.textTracks` (Shaka Player) |
| HBO Max / Max | Intercepta WebVTT del manifest HLS/DASH |
| Prime Video | Intercepta TTML embebido |

---

## Tests

```bash
pnpm vitest run   # 160/160 tests passing
```

Los tests cubren: tokenizador, MWE, lematización, parsers de fuentes de enriquecimiento, cadena de traducción, VAD, encoder WAV, y utilidades compartidas.

---

## Marca

**Kivara Lingo** es el primer producto de **Kivara**, una marca personal que albergará otras herramientas en el futuro (Kivara Notes, Kivara Read, etc.).

---

## Licencia

Por definir.
