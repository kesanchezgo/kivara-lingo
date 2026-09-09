# Endurecimiento del ranking de imágenes — 2026-09-06

Continuación del punto abierto #1 (imágenes) del veredicto de
`enrichment-relations-collocations-hardening-2026-09-06.md`, que cerró
notando que las imágenes nunca se habían evaluado por el harness (0
proveedores de imagen en `sourceLogs`; `img` vacío en las 30 tarjetas
porque el corpus corría `purpose: 'popover'`, que salta las fuentes de
imagen por diseño).

## Alcance y hallazgo de arquitectura

La tarjeta tiene DOS caminos de imagen distintos, y solo uno estaba roto:

- **Camino A — captura en vivo (viendo vídeo/serie):** la imagen es el
  frame real del `<video>` (`captureBestFrame`, `src/content/capture/frame.ts`,
  llamado en `App.tsx`) y el audio es el clip real de la frase
  (`extractAudioClip`, `capture-orchestrator.ts`). El frame tiene prioridad;
  solo cae al buscador web cuando `captureBestFrame` devuelve `null`. Este
  camino ya estaba sano y **no se tocó**.
- **Camino B — fan-out de enriquecimiento (palabra suelta, sin vídeo):**
  buscadores (Wikimedia/Openverse/Bing/DDG) + `pickImageCandidate`. Aquí
  vivían todos los casos rotos del brief (`piece of cake` → pastel,
  `week`/`know` → noticias/"did you know", `anything` → logos).

## Metodología: evidencia antes de calibrar

Nuevo probe dedicado `scripts/mv3-image-probe.mjs`:

- corre `purpose: 'card'` (fan-out de imágenes completo), sin frase por
  defecto para ejercitar el fallback web (Camino B);
- captura por token+tier el **pool CRUDO de candidatos con score y motivo
  de rechazo de cada uno**, vía el trace enriquecido
  `[kivara:enrichment:image]` (`orchestrator.ts`);
- corpus de imagen: apple, cat, tensor, run, anything, week, know,
  piece of cake, break up, lit, forget, support, give, umbrella, whatever.

Metodología idéntica al harness de corpus: tras `pnpm build` hay que
borrar el bytecode del SW del perfil
(`.audit/mv3-image-profile/Default/{Service Worker,Code Cache,Local
Extension Settings,IndexedDB}`) o Chrome ejecuta el worker anterior.

## Cambios aplicados (todo en `Camino B`)

Todo en `src/background/enrichment/`, sin tocar el Camino A ni el gate
sense-aware de relaciones.

### 1 — Refactor del ranking a función pura con trazas

`scoreImageCandidate` (pura, devuelve `{ score, reasons }` con reason
codes `ok-*`/`penalty-*`) + `rankImageCandidates` (ganador + pool
scoreado + `emptyReason`). `pickImageCandidate` delega — misma firma
pública. Es la única fuente de verdad que el probe consume.

### 2 — Jerarquía dura primaria > fallback

`PRIMARY_DISPLAYABLE_SOURCES` (Wikimedia/Openverse + Unsplash/Pixabay
BYOK) siempre ganan. `FALLBACK_DISPLAYABLE_SOURCES` (Bing/DDG) solo se
consideran cuando ningún primario califica, y aún así exigen ancla
lexical (`penalty-fallback-no-lexical-anchor`). Filosofía "pocos
confiables > muchos ruidosos" en código.

### 3 — Bing/DDG enriquecidos con metadata

Antes emitían solo `imageUrl` (sin title/dims) y el ranking los
descartaba de plano. Ahora Bing parsea `t`/`purl` y DDG parsea
`title`/dims → tienen metadata rankeable y pasan por el filtro
`badSubject`.

### 4 — Filtro de falso amigo por idioma

`looksNonEnglish(metadata)`: rechaza candidatos cuya metadata está
dominada por palabras-función de otro idioma. Evidencia: `lit` (inglés)
publicaba una **cama francesa** de Openverse (`lit` = cama en francés).
Tras el filtro, `lit` publica una cena con velas en inglés y se rechazan
5 muebles franceses.

### 5 — Gate estructural de verbo abstracto + red determinista

- **Gate estructural** (`STRICT_DEPICTION_POS`): un token con POS=verbo
  solo publica desde fuente anclada a concepto (Wikimedia P180) o con
  tags de depicción explícitos; un caption suelto de Openverse no basta.
  Dispara cuando una fuente taguea el POS.
- **Red determinista:** el probe reveló que WordNet **no taguea POS de
  forma fiable** para estos verbos (`pos` llegaba vacío, el gate no
  disparaba). Por eso `support`, `give`, `forget` (+ help, allow,
  provide, offer, believe, understand, remember, realize, decide,
  expect) se añaden a `LOW_IMAGEABILITY_WORDS`, respaldados por evidencia
  de corpus — la misma decisión ya tomada para `know`/`want`/`make`.
  `run` NO se añade (es imageable: correr).

### 6 — badSubject ampliado

Añadidos: `did-you-know`, `infographic`, `breaking`, `newspaper`,
`vector-art`, `graphics`, `icons`, `premium-photo`, `ai-generated`,
`wikihow`, `screenshot`, `avatar`. Cierra escapes reales del corpus
("Support Group Vector Art", "How to Give Flowers - wikiHow").

## Impacto medido (probe 2026-09-06, tier standard)

| token | antes | después |
|---|---|---|
| support | openverse "Twitter Support" (logo) | **EMPTY** (low-imageability) |
| give | openverse "Give to Humanity / Luke 6" (póster) | **EMPTY** |
| forget | openverse "We can't forget" (memorial) | **EMPTY** |
| lit | openverse "Lit d'Emile Gallé" (cama francesa) | openverse "Candle Lit Dinner" (inglés) |
| apple / cat / tensor / run / umbrella | correctos | correctos (sin regresión) |
| anything / week / know / whatever | EMPTY | EMPTY (sin cambio) |
| piece of cake / break up | EMPTY | EMPTY (gate de idiom, sin cambio) |

## Verificación

- Suite completa verde: `vitest run` → 33 files / 343 tests passed
  (eran 282 al inicio de la sesión de imágenes).
- Tests nuevos en `tests/unit/enrichment-orchestrator.test.ts`:
  jerarquía primaria>fallback, fallback con/sin ancla lexical, badSubject
  ampliado, pool scoreado con reason codes, patrón morfológico +
  señal POS, filtro de idioma (falso amigo `lit`), gate de verbo
  determinístico y estructural.
- `tsc --noEmit` exit 0. Diagnostics del orchestrator y de los parsers
  Bing/DDG: sin errores ni warnings.
- Probe re-corrido tras cada cambio para confirmar comportamiento con
  datos reales, no supuestos.

## Sigue abierto

1. **POS fiable:** el gate estructural `STRICT_DEPICTION_POS` es correcto
   pero infrautilizado porque WordNet no taguea POS de estos verbos.
   Cuando se amplíe la cobertura POS (WordNet u otra fuente), la red
   determinista de la lista puede reducirse. Hoy: cinturón y tirantes.
2. **`lit` polisémico:** publica "Candle Lit Dinner" (sentido iluminado)
   aunque la frase del corpus era el sentido slang "genial". Correcto en
   forma; el sentido exacto requiere binding sentido↔imagen (mismo trabajo
   pendiente que sinónimos por acepción, punto abierto #2).
3. **Unsplash/Pixabay:** BYOK, no ejercitados en el probe (sin clave). La
   jerarquía ya los coloca entre los primarios cuando hay clave.
