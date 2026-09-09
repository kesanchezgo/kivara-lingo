# Cierre de fugas vivas 2026-09-09 (segunda vuelta): lit, week, give, tensor

Cuatro crumbs del corpus vivo completo de 30 tarjetas
(`mv3-corpus-quality-2026-09-09.json`), mordidos en orden, cada uno con
evidencia viva antes y después.

## a) `lit` slang en relaciones → EMPTY honesto

**Antes:** `The show was lit.` publicaba syn `light-colored` / ant `dark`
(sentido color-luz para frase slang).
**Después:** syn/ant vacíos en ambos tiers.

**Cadena:** `lemmaCandidates` manda `lit→light`, WordNet trae 47 sentidos
de `light`, y el grupo color (`(used of color) having a relatively small
amount of coloring agent`) ganaba por `used` solo — que también vive en la
definición ganadora (`used as a general term of approval`).

**Cambios (`orchestrator.ts`, generales, cero reglas por token):**

- `used` a `GENERIC_SENSE_OVERLAP_WORDS`: overlap llevado solo por pegamento
  de glosa no prueba sentido, igual que `someth`/`about`/`have`.
- 1 test: victoria solo-`used` en sentido no-default salta; grupo
  sustantivo sigue publicando.

Commit `40426a5`.

## b) `week` + `give` en colocaciones → forma y sentido

**Antes:** `week` vip → `Passion Week`, `eventful week`, `a forty hour
week`; `give` vip → `give a grin/yawn/wave/smile/laugh/frown/signal/
movement` + `give someone something to eat`.
**Después:** `week` vip → `eventful week`; `give` vip → `give someone
something to eat`.

**Cambios (`normalizeCollocation`, generales):**

- Nombre propio (`Passion Week`, `Holy Week`): palabra capitalizada
  no-headword = nombre de festival, no chunk reutilizable.
- Frase de medida con número (`a forty hour week`, `a 40-hour week`):
  número = dato de instancia, no pairing léxico.
- Gestos de verbo ligero (`give a grin/smile/signal/movement…`):
  sustantivo de evento corporal = sentido gesto, no transferencia.
- 2 tests: nombres/medidas fuera, gestos fuera, chunks genuinos
  (`eventful week`, `working week`, `give advice`, PONS transfer) dentro.

Commit `a253683`.

## c) `tensor` etimología + fonética → sentido y limpieza

**Antes:** etimología de anatomía (`in anatomy, one of several muscles…,
1704`) para `The model uses a tensor.` (sentido ML); fonética Cambridge
`/ˈten.sə r/` con espacio interno.
**Después:** etimología MW latina (`borrowed from New Latin, from Latin
tendere…`); fonética `/ˈten.sər/` limpia.

**Cambios (generales):**

- `pickEtymology` acepta la definición ganadora: un párrafo con etiqueta
  de dominio (`in anatomy/botany/…`) que la definición no nombra pierde
  contra uno neutro. Segunda pasada en el merge (el bloque de etimología
  corre antes del pick de definición), con provenance
  `ok-definition-domain-match`. Sin definición, orden viejo intacto.
- Limpieza de IPA: espacio interno dentro de `/…/` colapsado (artefacto
  de scrapeo Cambridge, no fonética).
- 1 test: dominio ajeno pierde con definición, gana sin ella o con
  definición del mismo dominio.

Commit `0ad8d0c`.

## Verificación (los tres)

- `tsc --noEmit` limpio.
- Suite completa: 36 files / **389 tests passed**.
- Build `vite build` verde.
- Corpus vivo entero re-corrido tras cada cambio (30 tarjetas, 0
  errores), perfil limpiado antes de cada corrida (SW viejo = evidencia
  falsa).
- Diagnósticos temporales retirados; árbol sin rastros.

## Estado del corpus tras la vuelta

| caso | antes | después |
|---|---|---|
| `lit` vip syn/ant | light-colored/dark | EMPTY |
| `week` vip coll | Passion/eventful/forty hour | eventful week |
| `give` vip coll | 8 gestos + transfer | give someone something to eat |
| `tensor` vip ety | anatomía 1704 | latín MW |
| `tensor` vip phon | /ˈten.sə r/ | /ˈten.sər/ |
| `run`/`know`/`piece of cake` | correctos | sin cambio |
| standard (todo) | vacío controlado | sin cambio |
