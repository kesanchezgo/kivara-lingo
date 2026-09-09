# Colocaciones por sentido para verbos polisémicos — 2026-09-06 (noche)

Continuación del punto abierto **C** (`run`/`give` con `coll: []` en ambos
tiers) del veredicto de
`enrichment-relations-collocations-hardening-2026-09-06.md`, y del punto
abierto #4 del mismo (carencia de dato de fuente Longman/Oxford).

## Evidencia (scrapes vivos 2026-09-06, no supuestos)

Sonda temporal `scripts/tmp-colloc-probe.ts` (borrada tras verificar) contra
las 8 fuentes de colocaciones para `run` y `give`:

| fuente | `run` | `give` | veredicto |
|---|---|---|---|
| longman COLLO | 4-7 spans (`well/badly run`, `run on electricity/gas/petrol etc`, `run of good/bad luck`) | 13 spans (`give somebody control/authority/responsibility etc`, `give orders/instructions`…) | **materia prima real**, pero slash-comprimida |
| oxford `cf` | 10 patrones (`run something`, `run somebody + adv./prep.`…) | 15 patrones (`give something to somebody`…) | **patrón gramatical, no chunk** — nunca publicable |
| cambridge dictlink | sinónimos del thesaurus (`sprint`, `jog`) | 14 grupos vacíos de sinónimos | **no es fuente de colocaciones** |
| ozdic | 6 bloques con glosa (`on foot`, `of success/failure`…) | 1 bloque **sin glosa**, palabras de corpus (`better give`, `didn't give`) | run útil / give basura |
| pons | frases-oración (`to run across the street`, `the trains run…`) | `give tip/money/alms`, `give blood/organ`, `give attention`… | give útil tras expansión |
| dict.cc | `to run out`, `to run away` (phrasals) | `to give advice`, `to give birth` (phrasals) | útil pero infinitivo-marcado |
| datamuse | `run long`, `run the`, `run and` | `give you`, `give will`, `give and` | **ruido de corpus puro** |
| wiktHtml | `also-ran`, `assrun`, `hit-and-run` | derivados, no colocaciones | **no es fuente de colocaciones** |

Dos causas encadenadas explicaban el `coll: []`:

1. **Parser**: Longman comprimía con barras (`give orders/instructions`) y el
   merger rechazaba `a/b` por la regla `[~:/…]` — la materia prima moría
   antes de rankear.
2. **Merge**: aunque un chunk sobreviviera, el anchor plano lo mataba si no
   repetía palabras de la frase (`give a speech` vs `Give me the keys` →
   cero overlap → fuera). Y cuando un grupo ganaba el gate, el anchor
   re-mataba sus propios chunks (`well run` vs anchor {company,home,organize}).

## Cambios aplicados

### 1 — `expandSlashAlternatives` compartido (`html-utils.ts`)

Expande shorthand de diccionario con regla de seguridad estricta: solo
alternativas de **una palabra** comparten prefijo/sufijo; `six months/three
years` queda fuera en vez de adivinar el corte. Repara `an` varado
(`give an description` → `give a description`) y suelta `etc`. Usado por
Longman (COLLO) y PONS (filas de traducción). 5 tests en `html-utils.test.ts`.

### 2 — Grupos por sentido en Longman (`longman.ts`)

Cada span `COLLO` vive dentro de su bloque `Sense`, así que cada colocación
ya trae su `DEF` como ancla. Nuevo `extractLongmanSenseCollocationGroups`:
un relationGroup por sentido con guide+definition+collocations. El flat
sigue existiendo; los grupos cabalgan el mismo gate contextual que ozdic.
Verificado vivo: `give__3` (allow…) → control/authority/responsibility,
`give__4` (tell…) → orders/instructions, `run__3` (manage) → well/badly run.
3 tests en `longman-quality.test.ts`.

### 3 — Ozdic: veto a bloques sin glosa + ruido gramatical (`ozdic.ts`)

El único bloque de `give` no trae glosa: sin glosa no hay ancla para el gate
contextual, así que el bloque nunca publica (ni flat ni agrupado).
`OZDIC_NOISE_WORDS` filtra auxiliares/modales/negaciones (`have run`,
`didn't give`, `gonna give`) y la tilde `~` sin resolver (`run at a ~`).
1 test en `ozdic-collocations.test.ts`.

### 4 — PONS expande barras (`pons.ts`)

`normalizeCollocation` → `normalizeCollocations`: la misma expansión
compartida (`give tip/money/alms` → 3 chunks).

### 5 — Oxford `cf` deja de emitir (`oxford-learners.ts`)

Los spans `cf` son plantillas gramaticales (`give something to somebody`),
nunca chunks. Morían igual en `normalizeCollocation` (regla
something/somebody) pero costaban ruido de pool. Las colocaciones reales de
Oxford viven en el diccionario OCOLL de pago (`free: false`), no en esta
página. **Oxford queda fuera como fuente de colocaciones** hasta que se
verifique otra superficie scrapeable.

### 6 — Bypass anclado a victoria sustantiva (`orchestrator.ts`)

- `normalizeCollocation` acepta `isTrustedSource`: los chunks de bloque de
  diccionario (Longman/Cambridge/Oxford/bundled) se eximen de la regla
  -ly y de adverbios pelados. `well run` está en el bloque manage-sense de
  Longman — atestiguado por lexicógrafo, no accidente de corpus. Los
  bigrams de Datamuse siguen muriendo igual.
- `hasSubstantiveSenseOverlap`: la victoria de un grupo solo exime a sus
  chunks del anchor plano cuando el overlap trae **palabra de contenido**
  real. `someone`/`something` enmarcan TODOS los sentidos de `give`, así
  que un grupo que solo overlap por esas palabras no prueba nada y sus
  chunks siguen cabalgando el anchor. Lista cerrada (pronombres
  indefinidos + sustantivos ligeros), guardada **stemmeada** porque ambos
  lados pasan por `relationTerms` (`something` → `someth` — bug cazado por
  la sim antes de blindar).
- La llamada a `pickCollocations` pasa `undefined` como anchor solo cuando
  hay victoria sustantiva; en el resto, comportamiento idéntico al anterior.

## Impacto medido (sim del merge real con datos vivos)

Sim temporal bajo vitest (borrada tras verificar) replicando
`mergeFields` con los grupos y flats reales del probe:

| caso | antes | después |
|---|---|---|
| `run` / `She runs the company from home.` | `[]` | `["well run","badly run"]` (grupo manage, victoria sustantiva vía {business,organize}) |
| `give` / `Give me the keys, please.` | `[]` | `[]` (ausencia controlada: el grupo ganador solo overlap por someone/something; sus chunks no prueban el sentido y el anchor los frena con razón) |

`give` vacío es la decisión correcta hoy: publicar `give orders` para
`Give me the keys` sería fuga de acepción con otro nombre. Cuando Cambridge
Collocations (`/collocation/english/<w>`, verificado scrapeable: anchors
`hdib tb` + ejemplos `dexamp`) entre como autoridad por sentido, `give`
tendrá chunks del sentido transfer sin depender del anchor lexical.

## Verificación

- `tsc --noEmit` limpio.
- Suite completa: 33 files / **353 tests passed** (343 al inicio + 10
  nuevos netos: 5 slash, 3 longman-sense, 1 ozdic-veto, 2 bypass/overlap;
  1 test existente actualizado al nuevo contrato fuente-vs-forma).
- Build `vite build` verde.
- Probes temporales (`tmp-colloc-probe`, `tmp-slash-check`,
  `tmp-merge-sim`) borrados tras verificar; la evidencia vive en este
  reporte.

## Sigue abierto

1. **Fuente de colocaciones por sentido para `give`**: Cambridge
   `/collocation/english/<w>` verificado scrapeable (mismo patrón de markup
   que el diccionario principal). Siguiente crumb natural.
2. **dict.cc infinitivos** (`to give advice`, `to run out`): útiles pero la
   regla anti-infinitivo los mata a todos. Separar phrasal real (`run out`)
   de nota de uso requeriría su propio gate — no tocado aquí.
3. **PONS frases-oración** (`the trains run every half hour`): mueren en
   `isSourceSentence`, correcto. Sus chunks compactos (`give attention`,
   `give blood/organ`) ya fluyen tras la expansión.
