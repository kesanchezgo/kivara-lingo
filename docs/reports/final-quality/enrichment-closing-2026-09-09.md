# Cierre: BYOK rankeable + binding slang↔imagen — 2026-09-09 (actualizado)

Último vuelo de la serie. Lo que queda del fondo viejo, cerrado con
evidencia viva o diagnosticado con honestidad.

## 1. BYOK sin ejercitar → cerrado

Unsplash/Pixabay emitían `imageUrl` plano: un hero URL que saltaba todos
los gates del ranking (bad-subject, idioma, idiom). Ambos emiten ahora
`imageCandidates` rankeables con título/tags:

- Unsplash: `alt_description` + `tags` de la API (requiere key, sin key
  sigue en silencio).
- Pixabay Path A (API con key): `tags` + `pageURL` por hit.

El merge ya consumía `imageCandidates` por el ranking — cero cambios en el
merge. 4 tests nuevos en `image-source-candidates.test.ts`.

## 2. `lit` slang en imagen → CERRADO con vacío por sentido

**Estado:** EMPTY en ambos tiers, verificado en vivo.

**Cadena:** el primer mecanismo (ejes slang/literal + `penalty-…` por
candidato) era persecución: cada corrida viva traía un literal nuevo
(cena → costas → velas). El cierre real fue clasificar el sentido slang
no-depictable como low-imageability **por sentido, no por token**: cuando
la definición ganadora prueba slang (`ok-*-slang-sense`), `rankImageCandidates`
cortocircuita el pool entero a EMPTY con `slang-sense-undepictable` — la
misma regla de clase que `know`/`whatever`, decidida por la definición
ganadora en vez de la ortografía. Los ejes y el gate por candidato se
retiraron (código muerto).

Commits `957221e` (mecanismo) → `6b82581` (cierre por sentido).

## 2b. `lit` slang en relaciones → CERRADO con gate de pegamento

`lit→light` trae 47 sentidos de WordNet; el grupo color ganaba por `used`
solo (que también vive en la definición ganadora). `used` entró a
`GENERIC_SENSE_OVERLAP_WORDS`: victoria solo-pegamento en sentido
no-default salta. `lit` slang publica syn/ant EMPTY en ambos tiers.

Commit `40426a5`.

## 2c. `lit` slang en etimología → CERRADO con vacío

La historia de la palabra literal (`illuminated; afire, from light… drunk
1914`) es la historia del sentido equivocado en una tarjeta slang — no
hay etimología de "genial". `pickEtymology` devuelve vacío cuando la
definición ganadora es slang. Commit de esta vuelta.

## 3. POS estructural infrautilizado → cerrado por decisión

WordNet SÍ taguea POS en cada synset (`posLabel`: n/v/a/s/r) y el merge lo
consume en tres gates (definición, grupos, depiction estricta). La red
determinista (`LOW_IMAGEABILITY_WORDS`) cubre lo que WordNet no taguea.
No hay trabajo pendiente: la queja original era anterior al stemmer con
variantes y a los gates actuales. Se cierra sin código.

## Impacto medido (SW real, corpus entero, purpose card)

| caso | antes | después |
|---|---|---|
| `run`/manage vip coll | well run/badly run | sin cambio |
| `give` vip coll | transfer correcto | transfer (gestos fuera) |
| `know` vip syn | cognize/aware/… | sin cambio |
| `week` vip coll | Passion/eventful/forty hour | eventful week |
| `piece of cake` vip ant | pain/labor/chore/… | sin cambio |
| `lit` slang img | cena/costas/velas literales | **EMPTY ambos tiers** |
| `lit` slang syn/ant | light-colored/dark | **EMPTY ambos tiers** |
| `lit` slang ety | illuminated/afire… | **EMPTY** |
| `each` vip syn | any/all/several/… | apiece |
| `support` vip def | adopt as a belief | be behind; approve of |
| `anything`/`anybody` vip syn | whatever/something/… | EMPTY (como Standard) |
| `each`/`anything`/`anybody` vip coll | 8/1/1 fragmentos | EMPTY (como Standard) |
| standard (todo) | vacío controlado donde toca | sin cambio |

## Verificación

- `tsc --noEmit` limpio.
- Suite completa: 36 files / **394 tests passed**.
- Build `vite build` verde.
- Corpus vivo entero re-corrido (30 tarjetas, 0 errores) tras cada cambio,
  perfil limpiado antes de cada corrida (SW viejo = evidencia falsa).
- Diagnósticos temporales retirados; árbol sin rastros.
