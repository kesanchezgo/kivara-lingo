# Tier 5 — Backlog y siguientes pasos

## Completado en esta sesión (2026-05)

Esta sección documenta todo lo implementado en la sesión más reciente para que futuras sesiones conozcan el estado actual sin tener que reconstruir el razonamiento.

### Sistema de enriquecimiento multi-fuente (Standard + VIP)

- **Standard tier ampliado a 20 fuentes (siempre activo, sin clave):**
  - `wiktionary-html` (NUEVO): parsea etimología, sinónimos, antónimos y términos relacionados del HTML de Wiktionary. Scoped a la sección English para evitar contaminación de otros idiomas. Fallback phrasal para verbos frasales. Retry en cold cache (body < 1000 chars).
  - `thesaurus-com` (NUEVO): antónimos para sustantivos técnicos/abstractos. Autocorrect guard: si el headword de la página difiere del token, se descarta. CORS fix: `dictionary.com` añadido a `host_permissions`.
  - `wordhippo` (NUEVO): antónimos para MWEs, phrasals e idioms.
  - `the-idioms` (NUEVO): etimología de idioms.
- **VIP tier: 13 fuentes** (sin cambios en la lista, pero con guards añadidos).
- **Cobertura medida:** VIP 100 % / Standard 98.6 % en corpus de 20 palabras × 11 campos.
- **False-positive guards añadidos:**
  - Cambridge: di-title headword check + IPA distance guard (IPA debe estar dentro de 3000 chars del headword).
  - WordReference: filtro de celdas de cabecera ("Español" no se cuela como traducción).
  - thesaurus.com: autocorrect guard (descarta si el headword de la página difiere del token).
  - MyMemory: echo guard (descarta si la traducción es igual al texto fuente).

### MWE (Multi-Word Expression)

- **Índice MWE de Wiktionary** (`src/assets/mwes/en-mwe-index.json`): 13 501 frases de las categorías idioms + phrasal verbs + proverbs de Wiktionary. Solo keys (~40 KB gzip). Construido por `scripts/build-mwe-index.cjs`.
- **Lematización de MWEs** (`src/content/nlp/mwe-lemma.ts`): resuelve formas inflexionadas a formas de citación. "big girls" → "big girl", "kicked the bucket" → "kick the bucket", "looking up" → "look up". Integrado en el tokenizador y en `lookup()`.
- **Idioms NTC bundled** (`src/assets/dictionaries/en-idioms.json`): 14 318 idioms con definición + ejemplos del NTC's American Idioms Dictionary (zaghloul404/englishidioms, dominio público).
- **Phrasal etymology fallback** (`src/background/enrichment/phrasal-etymology-fallback.ts`): tabla bundled de etimología para 50 cabezas de verbos frasales comunes. Determinista, sin red, elimina jitter.

### Arquitectura de resolución en streaming (MAYOR)

- **Nuevo archivo:** `src/background/resolve-word.ts` — resolvedor por fases que emite: `local → translation → enrichment → ai → done`.
- **Port-based streaming:** el content script conecta al port `kvl-resolve-word` y recibe fases a medida que están listas.
- **El fold esencial se pinta en < 1 s** (instantáneo para palabras bundled, ~translation-latency para desconocidas).
- **Footer "buscando más…"** con puntos de pulso índigo mientras el enriquecimiento sigue en curso.
- **Mensaje legacy `RESOLVE_WORD`** mantenido como fallback (reutiliza el mismo resolver).
- **Fases en paralelo:** traducción + enriquecimiento + IA lanzadas con `Promise.allSettled`. Tiempo total = `max(t2, t3, t4)`, no la suma.

### Optimizaciones de rendimiento

- **Purpose-based enrichment:** `purpose: 'popover'` excluye 6 fuentes de imagen + cap de timeout a 2.5 s; `purpose: 'card'` ejecuta todas las fuentes con timeout completo. ~37 % más rápido en popover.
- **Traductor en carrera:** MyMemory + Lingva lanzados en paralelo, gana el primero que responde. `callChainRaced()` en `translate-providers.ts`.
- **LRU en memoria** (300 entradas) delante de IndexedDB `vip_cache`. Re-hover = ~0 ms. `clearMemEnrichmentCache()` llamado cuando el usuario limpia la caché.
- **Clave de caché incluye tier + purpose** para evitar que una entrada Standard satisfaga una consulta VIP.

### UX del popover

- **Skeleton unificado** (`LoadingCard`) visible hasta que llega la fase `local` — igual para todas las palabras.
- **Flag `resolving`** controla el skeleton; **flag `enriching`** controla el footer "buscando más…".
- **Ancho:** 288 px → 340 px.
- **Cuerpo scrollable** con max-height calculado desde el espacio disponible sobre el token (evita overflow por arriba).
- **Scrollbar de cristal fino** (clase `kvl-popover-scroll` en el CSS baseline del shadow-host).
- **`applyWaves` reemplazado** por manejadores de mensajes del port de streaming.

### Gestión de caché (UI)

- **Componente `CacheManager`** en VipSection: muestra estadísticas por bucket (enrichment, translation, AI, media) con número de filas y tamaño aproximado.
- **Botón "Limpiar caché"** con diálogo de confirmación que explica qué se borra y qué no.
- **Manejadores SW:** `GET_CACHE_STATS` / `CLEAR_CACHE`.
- **Módulo `cache-admin.ts`** con `getCacheStats()` y `clearCaches()`.

### Bug fixes

- **Cambridge false positive:** IPA de "party animal" se colaba en "kick the bucket" — corregido con di-title headword guard + IPA distance guard.
- **WordReference header:** "Español" se colaba como traducción — corregido con filtro de celdas de cabecera.
- **thesaurus.com autocorrect:** "zxqwflumph" → "galumph" — corregido con hdr-headword guard.
- **MyMemory echo:** devolvía el texto fuente como traducción — corregido con echo guard.
- **Unicode escapes:** `s\u00E9timo` en lugar de `séptimo` — corregido con `decodeJsUnicode()` en `html-utils.ts`, aplicado a la extracción de comentarios de Reverso.
- **CORS thesaurus.com:** redirect a `dictionary.com` bloqueado — corregido añadiendo `dictionary.com` a `host_permissions`.
- **Traducción MWE "—":** los stubs mostraban el placeholder — corregido ejecutando el traductor remoto cuando la traducción local es `—`.
- **Clave de caché VIP:** no incluía el tier, por lo que una entrada Standard satisfacía una consulta VIP — corregido.
- **Descifrado de claves BYOK:** `vip-settings.ts` no descifraba las claves de Unsplash/Pixabay — corregido.

### Otras mejoras

- **`decodeJsUnicode()`** añadido a `html-utils.ts`, integrado en `stripHtml()`.
- **VipSection UI:** 20 fuentes Standard listadas con descripciones, panel de gestión de caché.
- **`wiktionary-html` scoped a la sección English** para evitar contaminación de entradas en otros idiomas.
- **Retry en Wiktionary cold cache** (body vacío < 1000 chars dispara un reintento).

### Estado del proyecto al cierre de sesión

- **Tests:** 160/160 passing (`pnpm vitest run`).
- **Build:** `pnpm build` produce `dist/` sin errores.
- **Commits:** 37 commits adelante de `origin/main`.
- **Cobertura:** Standard 98.6 % / VIP 100 % en corpus de 20 palabras × 11 campos.

---

Este documento resume **lo que quedó pendiente** después del último PR de Tier 5
(URLs de galería + UI tweaks + export/import de cobertura). Cada item incluye
contexto y un plan de implementación concreto para retomar en una próxima
sesión sin tener que reconstruir el razonamiento.

> **Convención de tiers**: Tier 3 = base de packs / lookup pipeline · Tier 4 =
> seed CEFR + galería + telemetría local · Tier 5 = pulido y export/import +
> URLs reales. Todo lo de acá abajo sería **Tier 6+**.

---

## 1. Seed CEFR — siguientes lotes

**Estado actual** (post-PR #8):

| Archivo | Entries |
|---|---:|
| `data/cefr-b1-c1-en-es.json` | 1 445 |
| `data/cefr-b2-business.json` | 318 |
| `data/cefr-b2-c1-academic.json` | 413 |
| `data/cefr-b2-c1-society.json` | 347 |
| `data/cefr-b2-c1-tech-health.json` | 565 |
| **Total seed** | **3 088** |
| **Bundle `en.json`** (post `dict:build`) | **4 151** |

**Pendiente**:

- [ ] **A2 / B1 base** (~1 000 entradas): vocabulario frecuente para que el
      hover funcione en frases simples (verbos básicos, conectores, palabras de
      tiempo, expresiones cotidianas). Empezar por listas COCA-2000 + Oxford
      3000 filtradas a lo que no esté ya en el bundle.
- [ ] **C2 avanzado** (~500 entradas): vocabulario académico/literario alto
      (e.g. *circumlocution*, *epistemic*, *gainsay*). Difícil de seedear sin
      ruido — preferible curado manual con fuente de referencia.
- [ ] **Jerga técnica específica** (~500-800 entradas por dominio):
  - Machine learning / IA (tensor, embedding, fine-tuning, perplexity…)
  - Legal (tort, indemnify, deposition, statute…)
  - Médico (anaesthesia, oncology, anticoagulant…)
  - Finanzas avanzadas (hedge, derivative, securitisation…)

**Cómo hacerlo** (`scripts/expand-dictionary.ts` ya auto-descubre):

1. Crear `data/cefr-<nivel>-<dominio>.json` con shape `SeedEntry[]`.
2. `pnpm dict:build` — el build merge sin tocar el script.
3. `pnpm test && pnpm build` para verificar.

**Plantilla** (un entry):
```json
{
  "headword": "embedding",
  "pos": "noun",
  "definition_en": "A vector representation of a token in a learned semantic space.",
  "definition_es": "Representación vectorial de un token en un espacio semántico aprendido.",
  "examples": [
    { "en": "Word embeddings capture semantic similarity.", "es": "Los embeddings de palabras capturan similitud semántica." }
  ],
  "level": "C1",
  "tags": ["ml", "tech"]
}
```

---

## 2. Galería de packs — variantes faltantes

**Estado actual** (post-PR #5): la galería sólo lista los 5 packs cuya URL
está **verificada con `HTTP 200`** en el CDN R2:

- ✓ `kty-en-es.zip` (1.5 MB)
- ✓ `kty-es-en.zip` (22 MB)
- ✓ `kty-en-en.zip` (127 MB)
- ✓ `kty-es-es.zip` (38 MB)
- ✓ `kty-en-ipa.zip` (5 MB)

**Packs que originalmente listamos pero el CDN devuelve `HTTP 404`** y que
debemos volver a agregar cuando estén publicados:

- `kty-en-us-es.zip` — Wiktionary EN-US → ES
- `kty-en-uk-es.zip` — Wiktionary EN-UK → ES
- `kty-en-us-ipa.zip` — IPA específico US
- `kty-en-uk-ipa.zip` — IPA RP británica
- `kty-en-au-ipa.zip` — Australian English IPA
- `kty-en-freq-cefr.zip` — Frecuencia + CEFR
- `kty-tatoeba-en-es.zip` — Tatoeba EN↔ES ejemplos

**Cómo retomar**:

1. Re-correr el check de URLs (script al final de este doc) cada N días. Si
   alguno devuelve `200`, agregarlo de vuelta al array `RECOMMENDED_PACKS`
   en `src/app/components/tabs/DictPacksSection.tsx`.
2. Considerar mover a un CDN alternativo (GitHub Releases del repo
   `yomidevs/wiktionary-to-yomitan`) — los artefactos publicados usan el
   prefijo `wty-*` y siguen un calendario distinto.
3. Idea opcional: **chequeo de URL en runtime** — antes de mostrar el botón
   "Importar", hacer un `HEAD` y desactivarlo si el CDN devuelve 404.
   Trade-off: 1 request extra por pack al renderizar el panel.

**Script de verificación reutilizable** (también en `/tmp` del último build):
```bash
#!/bin/bash
BASE="https://pub-c3d38cca4dc2403b88934c56748f5144.r2.dev/releases/latest"
URLS=(
  "kty-en-us-es.zip" "kty-en-uk-es.zip" "kty-en-us-ipa.zip"
  "kty-en-uk-ipa.zip" "kty-en-au-ipa.zip" "kty-en-freq-cefr.zip"
  "kty-tatoeba-en-es.zip"
)
for u in "${URLS[@]}"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 -I "$BASE/$u")
  printf "%-30s %s\n" "$u" "$CODE"
done
```

---

## 3. Telemetría avanzada (no incluida en el último PR)

**Estado actual**:
- `pack_stats` table en Dexie v4 con cuatro buckets (bundle/packs/remote/miss).
- Master toggle en store.
- Hooks idempotentes en yomitan/csv/stardict/SW.
- **Export/Import JSON v1 (PR Tier 5)**: snapshot con merge o replace.
- Widget con tooltips + copy accionable.

**Pendiente para Tier 6**:

### 3.1 Mini-gráfico de tendencia (últimos 7 días)

- Nueva tabla Dexie `pack_stats_daily` con clave `(packId, yyyy-mm-dd)` y
  `hits` por día. Migración v5.
- En `recordLookupHit`, además de actualizar `pack_stats`, sumar 1 al bucket
  `(packId, today)`.
- Job de limpieza (ejecutado al cargar el panel): borrar filas con
  `yyyy-mm-dd < hoy - 7d`.
- En CoverageWidget, render de sparkline SVG inline (no usar libs, queda en
  ~30 LOC con `path d="M…L…"`).
- Tests: insertar fixtures de 7 días simulados y verificar agregaciones.

**Esquema sugerido para `pack_stats_daily`**:
```ts
interface PackStatsDailyRow {
  packId: string;   // FK lógico a pack_stats.packId
  day: string;      // 'YYYY-MM-DD' en TZ del usuario
  hits: number;
}
// índice primario: '[packId+day]'
```

### 3.2 Breakdown por idioma fuente

- Hoy todos los buckets viven en un único namespace global. Si un usuario hace
  hover en inglés y luego en alemán, las cuentas se mezclan.
- Cambiar el `packId` clave de `pack_stats` por `(packId, srcLang)` (e.g.
  `bundle::en`, `pack-abc::de`). Migración v6.
- En SW, el resolver ya conoce el `srcLang` del cue actual — pasarlo a
  `recordLookupHit(packId, srcLang)`.
- UI: tabs en el CoverageWidget (EN / DE / FR / etc.). Si el usuario sólo usó
  un idioma, no mostrar tabs.

### 3.3 Otros nice-to-have

- [ ] **Top 10 packs más usados**: ordenar `pack_stats` por `hits desc` y
      mostrar una lista compacta debajo del widget.
- [ ] **Detección de packs ociosos**: marcar visualmente los packs con
      `lastUsedAt < hoy - 30d` para sugerir desinstalación.
- [ ] **Auto-export semanal**: opcional, escribir el snapshot a
      `chrome.storage.local` cada domingo a la madrugada. Como backup
      automático.

---

## 4. Otros items menores

- [ ] **Auto-detect ZIP vs Yomitan vs StarDict**: hoy el usuario elige por
      botón. Inspeccionar el contenido del ZIP (`index.json` → yomitan,
      `*.ifo` → stardict) y rutear automáticamente.
- [ ] **i18n del panel**: todos los strings hoy están en español. Extraer a
      `src/shared/i18n/<locale>.ts` y wire un selector EN/ES en options.
- [ ] **Mover backlog a issues de GitHub**: este `.md` está bien para una
      sesión continua, pero ítems individuales convienen como issues.

---

## Cómo retomar este trabajo

```bash
# 1. Pull latest main
git checkout main && git pull

# 2. Crear rama nueva con timestamp
git checkout -b devin/$(date +%s)-tier6-<lo-que-sea>

# 3. Validar el toolchain antes de empezar
pnpm install
pnpm test          # debería pasar 81/81
pnpm dict:build    # debería decir "Dictionary after: 4151"
pnpm build         # extensión completa, < 4s
```

Si algo del backlog deja de tener sentido (porque el CDN cambió, porque otra
PR adelantó parte del trabajo, etc.), actualizar este doc primero y luego
implementar.
