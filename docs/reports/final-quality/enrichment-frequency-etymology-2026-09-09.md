# Frecuencia decidida + etimología estricta — 2026-09-09

Siguiente crumb del orden acordado tras dict.cc (commit `8268059`).

## Evidencia (corpus vivo completo, 30 tarjetas)

Corrida `scripts/mv3-corpus-quality.mjs --purpose card` entera (15 tokens ×
2 tiers) para decidir con datos, no con teoría:

- **Frecuencia**: todo vip con Longman S1/W1 trae además books-band
  (`run` → Hablado S1 + Escrito W1 + Libros 2: tres chips que no dicen
  nada). Standard trae books-band solo. Las tres escalas no son
  comparables (top-1000 hablado vs top-1000 escrito vs bandas
  corpus-por-millón), así que promediar o listar es ruido.
- **Etimología**: 14/15 tarjetas por tier la publican, casi siempre
  Etymonline; `break up` usa el fallback composicional del bundle;
  `piece of cake` queda vacío en ambos tiers (The Idioms devuelve `[]` en
  vivo — su página no sirvió Origin esta corrida; Etymonline no cubre
  idioms). Vacío honesto, no hueco a rellenar con anécdota.

## Decisiones

### 1 — Una sola banda ganadora (`src/shared/frequency.ts`)

Hablado Longman > escrito Longman > books-band. Misma regla en popover y
escritor Anki: una banda responde "qué tan común es", tres chips no.
Standard (books-band solo) no cambia. `pickFrequencyWinner` +
`formatFrequencyBand` compartidos; el popover y `capture-orchestrator`
renderizan el mismo valor.

| escala | tarjeta muestra |
|---|---|
| S1/W1… | Top 1000 hablado / Top 1000 escrito… |
| books 1-4 | Muy frecuente / Frecuente / Común / Poco común |
| desconocida | `escala: valor` (nunca vacío) |

### 2 — Etimología estricta (`pickEtymology`)

- Un párrafo con hedge (`maybe/perhaps/unknown/legend says/is said to/…`)
  pierde contra uno confiado **sin importar la fuente**: la anécdota de
  The Idioms no supera un párrafo limpio de rango menor.
- Si TODOS los candidatos dudan, la tarjeta queda vacía: sin etimología
  antes que etimología dudosa.
- `piece of cake` vacío en ambos tiers es el comportamiento correcto hoy,
  no un bug: ninguna fuente editorial cubrió el idiom en esta corrida.

## Impacto medido

| superficie | antes | después |
|---|---|---|
| popover frecuencia (`run` vip) | 3 chips (Hablado S1 · Escrito W1 · Libros 2) | 1 chip (Top 1000 hablado) |
| Anki `frequency` (`run` vip) | `Hablado S1 · Escrito W1 · Libros 2` | `Top 1000 hablado` |
| Anki `frequency` (standard) | `Libros N` | `Frecuente/Común/…` (misma banda, etiqueta que enseña) |
| etimología con hedge top-source | ganaba por prioridad | pierde contra párrafo confiado; todo-hedge → vacío |

## Verificación

- `tsc --noEmit` limpio.
- Suite completa: 36 files / **377 tests passed** (371 + 6 nuevos: 4
  frequency-band + 2 etymology-hedge; 1 test existente corregido al
  contrato real todo-hedge→vacío).
- Sin corrida viva nueva: el cambio de render no toca el merge (las
  evidencias siguen llegando igual al pool); la evidencia citada es el
  corpus completo ya corrido.

## Sigue abierto (fondo viejo, sin tocar)

1. POS estructural infrautilizado (WordNet no taguea estos verbos).
2. `lit` slang en imagen (binding sentido↔imagen).
3. BYOK Unsplash/Pixabay sin ejercitar.
4. Fugas vivas en B/C vistas en este corpus (`know` experiencia vs
   respuesta, `week` basura PONS, `piece of cake` antónimos literales):
   son crumbs propios con su verificación, no parte de este commit.
