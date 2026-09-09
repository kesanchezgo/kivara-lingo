# Cierre: BYOK rankeable + binding slang↔imagen — 2026-09-09

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

## 2. `lit` slang en imagen → mecanismo construido, literal sigue ganando

**Estado:** el binding existe y funciona en unit, pero en vivo `lit`
slang sigue publicando literal en ambos tiers (standard: pinimg, vip:
pixabay tealights).

**Lo construido:**

- Ejes slang/literal (`SLANG_AXIS_RE`/`LITERAL_AXIS_RE`, clases cerradas,
  cero reglas por token) + `penalty-slang-sense-literal-depiction` en el
  scorer + flag `slangSense` propagado por `rankImageCandidates`.
- Segunda pasada en el merge: cuando la definición ganadora prueba slang
  (`ok-*-slang-sense`), re-rank con el flag; traza y provenance escritas
  DESPUÉS del re-rank (la primera versión las escribía antes y la segunda
  llegaba tarde a todo — cazado en vivo).
- Test unit: cena con velas cae con el flag, fiesta sobrevive, `well-lit`
  con guion también cae.

**Por qué sigue ganando el literal en vivo:** el pool real no trae la
cena con velas de mentira del test — trae `well-lit coasts` y `tealights`,
y mi eje literal inicial no cazaba `well-lit` con guion. El eje ya se
amplió (`well-lit|well-lighted`) y el test lo blinda, pero cada corrida
viva trae un literal nuevo (cena → costas → velas). Los ejes son
persecución, no cierre.

**Diagnóstico honesto:** el binding sentido↔imagen necesita la señal
contraria — no "esta metadata es literal" (persecución infinita de
sinónimos de luz) sino "este token en este sentido ES imageable o no".
`lit` slang (genial) no tiene referente visual estable: es como `know` o
`whatever`, que ya van a EMPTY por clase cerrada. El cierre real es
clasificar los sentidos slang no-depictables como low-imageability por
sentido, no por token. Queda como crumb arquitectónico con su evidencia.

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
| `give` vip coll | transfer correcto | sin cambio |
| `know` vip syn | cognize/aware/… | sin cambio |
| `week` vip coll | Passion/eventful/forty hour | sin cambio |
| `piece of cake` vip ant | pain/labor/chore/… | sin cambio |
| `lit` slang img | cena/costas/velas literales | **sigue literal (diagnóstico arriba)** |
| standard (todo) | vacío controlado donde toca | sin cambio |

## Verificación

- `tsc --noEmit` limpio.
- Suite completa: 36 files / **385 tests passed**.
- Build `vite build` verde.
- Corpus vivo entero re-corrido (30 tarjetas, 0 errores) + probe de
  imágenes para `lit`.
