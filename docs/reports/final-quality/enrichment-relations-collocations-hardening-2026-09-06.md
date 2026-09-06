# Endurecimiento de relaciones y colocaciones — 2026-09-06

Continuación del orden de trabajo de
`enrichment-provider-field-quality-audit-2026-08-13.md` (puntos abiertos 2 y 3
del veredicto: sinónimos/antónimos ligados a acepción y colocaciones estrictas
en palabras polisémicas).

## Evidencia

Corrida de corpus completa en Chromium real (extensión + host permissions), 15
tokens × 2 tiers = 30 tarjetas finales:

- `docs/reports/final-quality/mv3-corpus-quality-2026-09-06.json`
  (generada 2026-09-06, ambas fases: pre-fix y post-fix sobre el mismo harness
  `scripts/mv3-corpus-quality.mjs`).

Tokens: apple, run (×2 sentidos), anything, anybody, each, tensor, lit,
break up, piece of cake, forget, support, give, know, week.

Nota de metodología: el harness limpia la caché de enriquecimiento por corrida
(`CLEAR_CACHE`, `cacheTtlDays: 0`), pero **no** invalida el bytecode del
service worker que Chrome cachea en el perfil. Tras `vite build` hay que borrar
`.audit/mv3-corpus-profile/Default/{Service Worker,Code Cache,Local Extension
Settings,IndexedDB}` o el navegador ejecuta el SW anterior y la tarjeta sale
idéntica pese al cambio de código. Verificado 2026-09-06.

## Cambios aplicados

Ambos cambios viven en `src/background/enrichment/orchestrator.ts` en la etapa
de filtro, sin tocar el gate sense-aware (`pickSenseRelationGroups`) ni la
priorización por fuente.

### A — Filtro de taxonomía y perifrasis en `pickRelatedTerms`

Nueva función `isTaxonomicOrPeriphrastic(value, token)`, aplicada como `continue`
dentro del bucle de candidatos. Rechaza, incluso desde fuentes displayable
(WordNet/Wiktionary):

1. **Binomios latinos** (`malus pumila`): dos palabras minúsculas, la primera
   con sufijo nominal latino (`us/um/is/a/ae/ex/ix/or/on`), ≥4 letras cada una,
   y el token ausente del par.
2. **Glosas hiperónimas** (`orchard apple tree`): candidato multi-palabra que
   contiene el token y termina en cabeza taxonómica
   (`tree/plant/animal/bird/fish/species/genus/fruit`).
3. **Perifrasis** (`to each one`, `for each one`, `any one thing`,
   `each and every one`): multi-palabra que abre con función-palabra y reutiliza
   la cabeza del token, o cadena de cuantificadores.
4. **Componente literal de un MWE** (`cake` como sinónimo de `piece of cake`):
   candidato de una sola palabra que es una palabra de contenido del propio
   headword multi-palabra.

Un sinónimo genuino de una o dos palabras (o con guion, `light-colored`)
sobrevive.

### C — Cobertura de colocaciones para verbos polisémicos

En el fallback editorial-plano de colocaciones (cuando hay gates de sentido
activos pero ningún grupo aporta chunks), se añade un conjunto de **autoridades
de colocación de diccionario de aprendizaje** (`longman`, `oxfordLearners`,
`cambridge`) cuyo chunk limpio (post `normalizeCollocation`) puede publicarse en
solitario. Objetivo: `run`/`give`, que traían 5-7 fuentes de colocación pero
publicaban vacío porque su grupo ozdic no superaba el gate contextual y el
camino plano exigía dos fuentes idénticas.

Contrato preservado deliberadamente:

- **Ozdic sigue requiriendo corroboración** (sense-aware pero corpus-derivado):
  test `publishes ozdic collocations only with corroboration`.
- Datamuse/PONS/dict.cc/wiktionary siguen siendo corroboración-solo.

## Impacto medido (antes → después, corpus 2026-09-06)

Sinónimos:

- `apple` (std+vip): `["malus pumila","orchard apple tree"]` → **vacío**
  (ausencia controlada; taxonomía eliminada).
- `each` (std): `["apiece","to each one","for each one","from each one"]` →
  `["apiece"]`.
- `anybody` (std): eliminados `any of`, `a person`, `any person`,
  `each and every one`.
- `piece of cake` (vip): eliminado `cake` (componente literal).

Colocaciones:

- `apple` (vip): 4 → 9 chunks.
- `week` (vip): 3 → 11 chunks.
- `support` (std): 8 → 10; `support` (vip): 2 → 4.

## Verificación

- Suite completa verde: `vitest run` → 30 files / 282 tests passed.
- Tests nuevos en `tests/unit/enrichment-orchestrator.test.ts`:
  - `drops taxonomy, hypernym glosses and periphrases even from displayable sources`;
  - `drops a literal-component word as a synonym of a multiword idiom`;
  - `publishes a solo learner-dictionary chunk for a polysemous verb`.
- Diagnostics del orchestrator: sin errores ni warnings.

## Sigue abierto (requiere binding por acepción, no filtro de forma)

Estos casos NO se tocaron porque son términos de una sola palabra, correctos en
forma pero de la acepción equivocada — sólo el binding sentido↔relación los
resuelve con seguridad, y necesitan su propia verificación de corpus:

1. `know` (vip) → `experience/taste/endure/suffer/undergo`: sentido "vivir/
   experimentar", no "conocer la respuesta". La lista plana de thesaurusCom no
   trae metadato de acepción.
2. `piece of cake` (vip) antónimos ruidosos (`bear/beast/murder/stinker`):
   corroborados en esta corrida, así que el gate de corroboración no los frena;
   requieren gate figurado por sentido.
3. `each` (vip) asociaciones amplias (`any/all/several/respective`).
4. `run`/`give` colocaciones: la lógica de autoridad-solo es correcta (probada
   en unit test), pero Longman/Oxford no emitieron un chunk que superara
   `normalizeCollocation` en esta corrida — es carencia de dato de fuente, no de
   lógica. Reevaluar cuando se amplíe el parser de bloques de colocación.

Las imágenes siguen sin evaluarse por este harness (0 proveedores de imagen en
`sourceLogs`; `img` vacío en las 30 tarjetas): pendiente de un probe de imágenes
dedicado antes de rankear.
