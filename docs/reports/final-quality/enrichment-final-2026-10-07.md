# Reporte final limpio — calidad A/B + packs offline + dieta — 2026-10-07

Corpus contextual completo: 15 tokens × 2 tiers = 30 tarjetas, 0 errores,
`tsc` limpio, 399 verdes, `vite build` verde. Dos perfiles: fresco (sin packs)
y yomitan (`kty-en-es` 61.076 + `kty-en-ipa` 139.674, instalados vía
`scripts/seed-yomitan-packs.mjs`).

## Sin packs (perfil fresco)

| campo | Standard | VIP |
|---|---|---|
| traducción | 15/15 | 15/15 |
| definición | 15/15 | 15/15 |
| ejemplos | 15/15 | 15/15 |
| IPA | 13/15 | 13/15 |
| etimología | 14/15 | 14/15 |
| imagen web | 4/15 | 4/15 |
| sinónimos | 9/15 | 10/15 |
| antónimos | 2/15 | 7/15 |
| colocaciones | 7/15 | 8/15 |

## Con packs (perfil yomitan)

| campo | Standard | VIP |
|---|---|---|
| traducción | 15/15 (más rica: `Dar. Entregar.`, `Conocer, saber.`) | 15/15 |
| IPA | **15/15** | **15/15** |
| sinónimos | 8/15 | 10/15 |
| colocaciones | 7/15 | 6/15 |
| antónimos | 1/15 | 6/15 |

## Veredicto packs

- **Ganan:** IPA total (13→15) + traducción rica + offline <1ms.
- **No dan:** syn/ant/coll (el pack no los trae: 3-4 menciones en 61k
  términos, contado a mano del ZIP). Su valor es first-paint, no relaciones.
- **Recomendados:** `kty-en-es` CORE auto + `kty-en-ipa` RECOMENDADO auto.
  `kty-en-en` 127MB solo galería premium (definición 15/15 ya cubierta).
- Copy de tamaños corregido con conteos reales del ZIP (commit `cc639f5`).

## Dieta del bundle (commit `ccac158`)

- `en-idioms.json` 14.318 → 1.614 entradas HOT (intersección con el índice
  MWE del tokenizer: `piece of cake`, `break up`, `kick the bucket`
  sobreviven). 3.8MB → 417KB fuente.
- Chunk dictionary 5.9MB → 2.3MB (-60%). COLD 12.7k en
  `.audit/en-idioms-cold.json` como candidatas lazy-load (requiere
  `lookupDictionary` async — crumb aparte, no movido a propósito).
- Misma cobertura A/B tras el trim, cero regresiones, corpus vivo 30/30.

## Cobertura por token (VIP, referencia)

- `run` movimiento: syn motion + coll motion, imagen WIN.
- `run` manage: syn operate/manage + `well/badly run` + `company/business`.
- `give`: transfer + `give someone something to eat`, ejemplos transfer.
- `lit` slang: syn/ant/coll/img/ety EMPTY (correcto).
- `each`: solo `apiece`. `anything`/`anybody`: EMPTY (slot gramatical).
- `support`: def respaldo + syn respaldo (manutención fuera con anchor).
- `week`: `eventful week`, sin `Passion/forty hour`.
- `tensor`: etimología latina MW + IPA limpia.
- `piece of cake`: syn sin `roses/nothing/cake`, ant figurados.
- `break up`: syn relación, coll EMPTY (pool = fragmentos, correcto).

## Pendiente (fuera del código)

1. `kty-en-en` 127MB sin medir (costo sin ganancia esperada: definición 15/15).
2. COLD 12.7k `en-idioms` a lazy-load: requiere `lookupDictionary` async
   (tokenizer + popover + SW lo usan sync). Crumb arquitectónico aparte.
3. Frame/audio vivo en streaming: sin sesión real no hay prueba.
   El flujo en código está amarrado (ver `docs/reports/final-quality/enrichment-capture-flow-2026-10-07.md`).
4. BYOK sin claves: Unsplash/Pixabay dormidas, correcto.
