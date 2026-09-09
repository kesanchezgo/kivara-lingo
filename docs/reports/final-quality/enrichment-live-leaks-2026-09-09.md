# Tres fugas vivas cerradas: `know`, `week`, `piece of cake` — 2026-09-09

Crumbs señalados del corpus vivo completo de 30 tarjetas
(`mv3-corpus-quality-2026-09-09.json`), en el orden acordado.

## 1. `know` VIP: sinónimos de la acepción equivocada

**Antes:** `experience/taste/endure/suffer/undergo` (vivir algo) para
`I do not know the answer` (conocer la respuesta).
**Después:** `cognize/aware/conscious/cognizant/cognise`.

**Cadena (dos diagnósticos temporales en el SW real, ya retirados):**

1. MW emite el grupo `to experience` (`to come to a knowledge of
   (something) by living through it`) y gana su fuente con overlap
   `someth` — pegamento que toda glosa comparte.
2. Mi primer fix (ordenar por overlap sustantivo) no bastó: el grupo
   experience era el ÚNICO de su fuente, así que ganaba igual por
   defecto y entraba al pool.
3. El fix real: una victoria solo-genérica en sentido NO-default **no
   publica** (igual que un overlap cero). La excepción del sentido
   default preserva a Longman `give__3` (`to put something in someone's
   hand` para `Give me the keys`).

**Cambios:**

- `GENERIC_SENSE_OVERLAP_WORDS` ampliada a pegamento definicional
  (`be/have/get/about/such`): `to be sure about something` vs `to have
  direct experience of something` ya no se distinguen por pegamento.
- `pickSenseRelationGroups` ordena por overlap sustantivo primero (raw
  como desempate, preservando el fallback viejo) y salta victorias
  genéricas en sentidos no-default.
- 3 tests: preferencia sustantiva, skip genérico (con corrección del
  default), encuentro singular-plural.

## 2. `week` VIP: basura PONS/Longman en colocaciones

**Antes:** `once times etc a week`, `spirit week SCHOOL USA`,
`a thirty-seven-and-a-half hour week`.
**Después:** `Passion Week`, `eventful week`, `a forty hour week`.

**Cambios (`normalizeCollocation`, generales, cero reglas por token):**

- `etc` suelto mid-chunk → fuera (el trailing ya lo quitaba la
  expansión slash; un `etc` medio significa fila de variantes).
- Etiquetas de dominio en mayúsculas (`SCHOOL USA`) → fuera.
- Números multi-guion (`thirty-seven-and-a-half`) → fuera.
- 1 test con los tres casos vivos + supervivientes genuinos.

## 3. `piece of cake` VIP: antónimos del sentido literal

**Antes:** `pain/bear/labor/beast/chore/killer/murder/stinker`.
**Después:** `pain/labor/chore/trouble/headache/sticky wicket`.

**Cadena:** el fixture MW trae UN bloque idiomático con 18 antónimos
mezclados; MW es displayable y no sense-blind → bypass total del anchor →
los 8 primeros por orden de llegada. No es fuga de otra acepción: es
ruido DENTRO del sentido correcto. WordNet idiomático trae 8 sinónimos y
CERO antónimos, así que los 8 publicados eran 100% MW sin filtro.

**Cambios:**

- `isFigurativeAntonym` + `FIGURATIVE_ANTONYM_BRIDGE` (eje
  easy/difficult + malestar): un antónimo de idiom sobrevive solo con
  puente léxico al sentido figurado (`pain/labor` vía difficulty);
  `bear/beast/murder/stinker` mueren sin puente. Frases multi-palabra
  exentas (traen su propio contexto).
- Aplicado solo a headwords multi-palabra en el pool de antónimos.
- 1 test + 1 ampliación del puente (`headache/nuisance/bother`, que el
  primer test cantó con razón).

## Impacto medido (SW real, corpus entero, purpose card)

| caso | antes | después |
|---|---|---|
| `know` vip syn | experience/taste/endure/suffer… | cognize/aware/conscious/cognizant/cognise |
| `week` vip coll | once times etc…/SCHOOL USA/… | Passion Week/eventful week/a forty hour week |
| `piece of cake` vip ant | pain/bear/labor/beast/chore/killer/murder/stinker | pain/labor/chore/trouble/headache/sticky wicket |
| `run`/manage vip coll | well run/badly run | sin cambio |
| `give` vip coll | sentido transfer | sin cambio (sentido correcto preservado) |

## Verificación

- `tsc --noEmit` limpio.
- Suite completa: 36 files / **381 tests passed**.
- Build `vite build` verde.
- Corpus vivo entero re-corrido (30 tarjetas, 0 errores).
- Diagnósticos temporales retirados; árbol sin rastros.
