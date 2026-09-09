# Colocaciones `give`: cierre del vacío controlado — 2026-09-09

Continuación del punto abierto **C** (`run`/`give` con `coll: []`) y del
reporte `enrichment-collocations-sense-2026-09-06.md`, que dejó `give` en
vacío controlado a propósito: publicar `give orders` para `Give me the keys`
habría sido fuga de acepción con otro nombre.

## Evidencia (SW real, no sim)

Corrida viva `scripts/mv3-corpus-quality.mjs --tokens give,run --purpose card`
con diagnóstico temporal en el merge (ya retirado):

- PONS `(to hand)` SÍ gana el gate contextual (vía `hand`) y el bypass SÍ
  dispara (`collocationsSenseScoped: true`).
- Pero su único chunk, `give her something to eat`, moría en
  `normalizeCollocation`: la regla blunt `something|somebody + ≤5 palabras`
  lo mataba como "ruido de plantilla".
- Esa regla nació para plantillas Oxford (`give something to somebody`),
  pero también mataba chunks reales con palabra de contenido
  (`give somebody control`, `give her something to eat`).
- Segunda muerte encadenada: aunque el chunk sobreviviera, PONS no es
  displayable → el filtro de conteo (`sources.size > 1`) lo mataba igual sin
  endoso por sentido.

## Cambios aplicados

### 1 — PONS: pronombres objeto → slot (`sources/pons.ts`)

`normalizeCollocations` mapea `her|him|me|them|us|you → someone`. Las filas
PONS traen slots de argumento (`give her/me/them a glass of water`); sin
esto el chunk conserva el pronombre de la oración-fuente y muere como ruido
específico. Verificado vivo 2026-09-09.

### 2 — Regla template fina (`orchestrator.ts`)

La regla blunt `something|somebody + ≤5 palabras` se reemplaza por
`isTemplatePattern`: un chunk solo es plantilla si **todas** sus palabras
no-headword son filler (slot pronominal, artículo, preposición). Una sola
palabra de contenido lo salva:

- `give something to somebody` → plantilla (muere).
- `run somebody + adv./prep.` → plantilla (muere).
- `give somebody control` → real (vive).
- `give someone something to eat` → real (vive: `eat` es contenido).

### 3 — Endoso por sentido en `pickCollocations` (`orchestrator.ts`)

Los chunks del grupo seleccionado llevan `senseBound: true` en el pool y
quedan exentos del filtro de conteo/displayable: el gate contextual que ya
ganaron vía su glosa **ES** su corroboración. Las reglas de forma
(`normalizeCollocation`) siguen aplicando: el gate nunca excusa una
plantilla.

## Impacto medido (SW real, purpose card)

| caso | antes | después |
|---|---|---|
| `give` / `Give me the keys, please.` (vip) | `[]` | `["give someone something to eat"]` (pons, sentido transfer) |
| `run` / `She runs the company…` (vip) | `["well run","badly run"]` | sin cambio (cero regresión) |
| `run` motion, standard ambos | `[]` / sinónimos correctos | sin cambio |

## Verificación

- `tsc --noEmit` limpio.
- Suite completa: 34 files / **364 tests passed** (355 + 9 nuevos: 6 PONS
  sense-groups + 1 ejemplo-por-segmento + 2 template/senseBound).
- Build `vite build` verde.
- Corrida viva `mv3-corpus-quality-2026-09-09.json` con `give` publicando.
- Diagnósticos temporales (`merge:givediag`, `collocdiag`, `pooldiag`)
  retirados; el árbol no conserva rastros.

## Sigue abierto (orden ya acordado)

1. Gate fino dict.cc (`to give advice` vs nota de uso) — útil pero
   infinitivo-marcado; requiere su propio gate, no tocado aquí.
2. Decisión de frecuencia + política de etimología.
3. `frequencyRank` sin fuente fiable.
