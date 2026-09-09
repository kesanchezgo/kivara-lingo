# dict.cc: gate fino para colocaciones — 2026-09-09

Siguiente crumb del orden acordado tras cerrar `give` (reporte
`enrichment-collocations-give-2026-09-09.md`).

## Evidencia (scrape vivo 2026-09-09, no supuestos)

Sonda temporal `scripts/tmp-dictcc-probe.mjs` (borrada tras verificar)
contra las filas `c1Arr`/`c2Arr` reales:

- `give`: 51 filas, casi todas `to give X` (`to give advice`, `to give
  birth`, `to give classes`, `to give consent`…) + phrasals (`to give in`,
  `to give up`, `to give out`) + oraciones (`Give over moaning!`).
- `run`: 52 filas, mismo patrón (`to run aground`, `to run out`,
  `to run a country`, `to run a risk`…) + `home run`, `long run`.

Sin gate fino, esas filas llegaban al merger como `to give advice` y morían
todas en la regla anti-infinitivo (nota de uso). dict.cc quedaba como fuente
muerta de colocaciones pese a tener la mejor materia prima compacta.

## Cambios aplicados (`sources/dictcc.ts`)

### 1 — `norm` decodifica `\'`

Las filas traen `one\\'s` escapado (`to give one\\'s approval`); sin esto el
chunk conserva la barra invertida. Un reemplazo, cero riesgo.

### 2 — `bareCollocationChunks` (plural, exportada)

- Parte puntos finales (`sb.` al final de `to give in to sth.`).
- Normaliza slots `sb|sth → someone`, `sb/sth → someone`.
- Despoja el marcador de infinitivo (`to give advice` → `give advice`):
  una fila bare de diccionario es chunk real, no nota de uso.
- Expande variantes con barra con la misma regla single-word de
  Longman/PONS (`to run away / off` → `run away` + `run off`).
- Rechaza filas solo-slot (`to give`, `to give sth.`): sin colocante
  léxico, el guard de plantillas del merger las mataría igual.

### 3 — El loop emite chunks bare

`to give advice` alimenta colocaciones como `give advice`; `to give`
sigue alimentando solo traducciones.

## Impacto medido (SW real, purpose card)

Predicción honesta antes de correr: **cero cambio visible**. dict.cc no es
autoridad displayable ni grupo de sentido, así que sus chunks necesitan
endoso o segundo editorial — y ninguno de sus chunks coincide hoy con los
grupos Longman/PONS seleccionados. La corrida lo confirmó:

| caso | antes | después |
|---|---|---|
| `give` vip | `["give someone something to eat"]` | idéntico |
| `run`/manage vip | `["well run","badly run"]` | idéntico |
| resto | idéntico | idéntico |

Lo que SÍ cambió es invisible pero real: los chunks dict.cc ahora llegan al
pool con forma bare y rankeable (`give advice`, `run out`, `run away`) en vez
de morir en forma infinitivo. Cuando un grupo de sentido o un segundo
editorial los endose, publican. Sin este gate nunca podrían.

## Verificación

- `tsc --noEmit` limpio.
- Suite completa: 35 files / **371 tests passed** (364 + 7 nuevos dict.cc).
- Build `vite build` verde.
- Corrida viva `mv3-corpus-quality-2026-09-09.json` sin regresiones
  (la cuenta de fuentes por fila varía por timing de red, 0 fallos).
- Sonda temporal borrada; la evidencia vive en este reporte.

## Sigue abierto (orden ya acordado)

1. Decisión de frecuencia + política de etimología.
2. `frequencyRank` sin fuente fiable.
