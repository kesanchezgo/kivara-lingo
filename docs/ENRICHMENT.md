# Multi-source enrichment — Standard + VIP

How Kivara Lingo populates the popover and the Anki card with rich
data from up to 30 dictionaries / scrapes / image sources without
needing any API key from the user.

## Tier overview

| Tier | Always on? | # fuentes | Sources |
|---|---|:---:|---|
| **Local** | ✅ | — | Bundled `en.json` + `en-extensions` + `en-idioms` (14 318 NTC idioms) + Oxford 3000/5000 CEFR + Oxford Phrasal Academic Lexicon + Academic Collocation List + Fernald Thesaurus 1896 + MWE index (13 501 frases) + Yomitan packs (`kty-en-es`, `kty-en-en`, `kty-en-ipa`, `kty-es-en`, `kty-es-es`) |
| **Standard** | ✅ | **20** | free-dictionary · datamuse · wiktionary-rest · **wiktionary-html** (etymology + synonyms + antonyms + related terms, scoped to English section, phrasal fallback) · wiktionary-api (freedictionaryapi.com) · moby-thesaurus · **thesaurus-com** (antonyms para sustantivos técnicos/abstractos, con autocorrect guard) · **wordhippo** (antonyms para MWEs/phrasals/idioms) · **the-idioms** (etimología de idioms) · etymonline · tatoeba · lingua-libre · google-tts · bing-images · openverse · wikimedia-commons · duckduckgo-images · youglish · mymemory · lingva |
| **VIP** | toggle in Settings | **13** | cambridge · oxford-learners · longman · collins · merriam-webster · **ozdic** (Oxford Collocations) · reverso · linguee · wordreference · spanishdict · forvo · **unsplash (BYOK)** · **pixabay (BYOK opt.)** |
| **AI** | toggle + API key | — | OpenAI / Anthropic / Gemini — genera definición contextual, sinónimos, colocaciones, registro, **mnemónico**, **etimología**, y **imagen DALL-E 3** (solo OpenAI, opt-in via `enableDalleFallback`, ~$0.04/tarjeta) |

Every source is independent: a Cambridge timeout never blocks Reverso.
Failures are silent — the popover just renders less.

## The flow

### Arquitectura de streaming (port `kvl-resolve-word`)

El content script abre un puerto al service worker (`src/background/resolve-word.ts`) y recibe fases a medida que están listas. Las fases de traducción, enriquecimiento e IA se lanzan en paralelo (`Promise.allSettled`), por lo que el tiempo total es `max(t2, t3, t4)`, no la suma.

```
hover token
        │
        ▼
content script abre port kvl-resolve-word
        │
        ▼
resolve-word.ts (src/background/resolve-word.ts)
        │
        ├── fase: local  (sync, < 1 ms)
        │    bundled + Yomitan packs (lemma-aware, MWE-aware)
        │    → emite { phase: 'local', entry }
        │    → content pinta el fold esencial, oculta skeleton
        │
        ├── fase: translation  (~200–500 ms)  ┐
        │    MyMemory ∥ Lingva (callChainRaced) │ lanzadas en
        │    → emite { phase: 'translation' }  │ paralelo
        │                                       │
        ├── fase: enrichment  (~300–2000 ms)   │
        │    fan-out a 20–33 fuentes            │
        │    purpose: 'popover' → excluye 6     │
        │    fuentes de imagen + cap 2.5 s      │
        │    purpose: 'card' → todas + timeout  │
        │    completo                           │
        │    → emite { phase: 'enrichment' }   ┘
        │
        ├── fase: ai  (~1–3 s, solo si activo)
        │    OpenAI / Anthropic / Gemini
        │    gated por preferAiMnemonic / preferAiEtymology
        │    → emite { phase: 'ai' }
        │
        └── fase: done
             → emite { phase: 'done' }
             → content oculta footer "buscando más…"
```

**Indicadores de UX durante la resolución:**
- `resolving` flag → muestra `LoadingCard` skeleton hasta que llega la fase `local`.
- `enriching` flag → muestra footer "buscando más…" con puntos de pulso índigo mientras llegan las fases `enrichment` / `ai`.

**Fallback legacy:** el mensaje `RESOLVE_WORD` (sin port) sigue funcionando y reutiliza el mismo resolver. Se usa para creación de tarjetas desde el panel.

## Where the user controls each tier

| Tier | UI location | Toggle behaviour |
|---|---|---|
| **Bundled overlays** | Settings → "Enriquecimiento (Standard + VIP)" → top info panel (read-only) | Always active. Shipped with the extension as ~250 KB of JSON. |
| **Yomitan packs** | Settings → "Diccionarios offline" | Each pack has `Instalar` / `Eliminar` / on/off toggle. |
| **Standard tier** (Free Dictionary + Datamuse) | Settings → "Enriquecimiento" → "Estándar (gratis, siempre activo)" | Both default-on. Each source individually disable-able from a checkbox. Runs **regardless** of VIP master switch. |
| **VIP tier** (20 free + 2 BYOK sources) | Settings → "Enriquecimiento" → master toggle → groups | Master switch off by default. Once on, every source defaults on with individual checkboxes grouped by category. |
| **BYOK API keys** (Unsplash, Pixabay) | Settings → "Enriquecimiento" → "Claves API opcionales" | Optional inputs. Without keys: Unsplash is inactive (Anubis gate), Pixabay falls back to scraping. With keys: official APIs (more reliable). |
| **AI provider + flags** | Settings → "IA premium" | Provider + API key, `enrichOnHover`, `enrichOnSave`, `preferAiMnemonic`, `preferAiEtymology`, `enableDalleFallback` (only visible when provider = `openai`). |

## Bundled offline assets

Eight bundled JSONs ship with the extension (no download, no network).
They merge into `dictionary.ts` at module load time so the popover
has rich data even with VIP off and zero internet.

| File | Entries | Source | What it adds |
|---|---|---|---|
| `src/assets/dictionaries/en.json` | 4 151 | Curated (audited 2026-05) | Translation, bilingual, monolingual (≤360 chars), IPA, level, examples |
| `src/assets/dictionaries/en-extensions.json` | 357 | Hand-curated | Phrasal verbs + idioms + cognates missed by the bundle |
| `src/assets/dictionaries/en-cefr.json` | 4 951 | Oxford 3000 + 5000 (jnoodle/English-Vocabulary-Word-List) | `level: A2 \| B2` overlay |
| `src/assets/dictionaries/en-idioms.json` | 14 318 | NTC's American Idioms Dictionary (zaghloul404/englishidioms, public domain) | Idioms con definición + ejemplos |
| `src/assets/mwes/en.json` | 150 | Hand-curated | Common MWE entries |
| `src/assets/mwes/en-phrasal-academic.json` | 673 | Oxford Phrasal Academic Lexicon | Academic phrases tokenized as MWE (translation field is `—` placeholder by design) |
| `src/assets/mwes/en-mwe-index.json` | 13 501 | Wiktionary idioms + phrasal verbs + proverbs categories | Keys-only index (~40 KB gzip) para detección de MWEs. Construido por `scripts/build-mwe-index.cjs`. |
| `src/assets/collocations/academic-collocation-list.json` | 472 | Ackermann & Chen 2013 (open access) | `collocations` overlay |
| `src/assets/thesaurus/en-thesaurus.json` | 611 | Fernald 1896 (public domain) | `synonyms` + `antonyms` overlay (uses `syn`/`ant` keys internally) |

Total bundle weight: ~3.5 MB raw, ~300 KB gzipped.

### Bundle integrity guarantees (audited 2026-05-23)

The audit script checks every bundle for these classes of bugs and
each currently reports **zero hits**:

- `ISO 639-N language code for ...` template leaks
- Useless self-translations (`audible → "audible"`) — **except** valid
  cognates flagged by hand (`inevitable`, `radio`, etc.)
- 1-character translations (`b → "b"`)
- Wikitext / template noise (`{{...}}`, `[[...]]`, `<ref>`)
- HTML noise inside fields
- Monolinguals or examples > 400 chars (trimmed to first 2 sentences /
  ≤ 360 chars during the deep audit pass)

Two intentional patterns the audit script flags as "issues" but are
correct by design:

- 115 form-of monolinguals in `en.json` (`plural of activity`,
  `past of run`, etc.) — kept on purpose, useful when the user hovers
  the inflected form directly.
- 672 phrasal entries in `en-phrasal-academic.json` carry
  `translation: "—"` — they're MWE markers for the tokenizer, not
  bilingual entries. The popover renderer treats `—` as "no
  translation" and falls through to the VIP chain.

## Yomitan packs (downloadable)

Five curated packs hosted on a Cloudflare R2 bucket, generated weekly
by `kaikki-to-yomitan`. Each pack is a Yomitan format-3 ZIP with
`index.json` + `term_bank_*.json` + `tag_bank_*.json` + `styles.css`.

| Pack | Size | Coverage | Tier |
|---|---|---|---|
| `kty-en-es.zip` | 1.5 MB | EN→ES bilingual (~67k entries) | core |
| `kty-es-en.zip` | 22 MB | ES→EN bilingual (~250k entries) | recommended |
| `kty-en-en.zip` | 127 MB | EN→EN monolingual (~500k entries) | premium |
| `kty-es-es.zip` | 38 MB | ES→ES monolingual | recommended |
| `kty-en-ipa.zip` | 5 MB | EN IPA pronunciation overlay | recommended |

Verified live 2026-05: all 5 ZIPs return HTTP 200 from
`https://pub-c3d38cca4dc2403b88934c56748f5144.r2.dev/releases/latest/`.
Format 3 schema is parsed by `src/content/nlp/yomitan.ts` (streaming
`Unzip` to keep peak memory bounded by one term_bank file at a time).

The onboarding wizard auto-installs `kty-en-es` + `kty-en-ipa`. Full
gallery (5 packs) lives in `Settings → Diccionarios offline`.

## Source contract

Each source lives in `src/background/enrichment/sources/<name>.ts` and
default-exports an object matching `EnrichmentSource`:

```ts
{
  id: 'cambridge',          // matches the VipSettings flag
  label: 'Cambridge',       // surfaced in the UI badge
  async enrich(token, ctx) → SourcePartial
}
```

The orchestrator reads `vip[id]` to decide whether to run a source.
Sources MUST never throw — return `{}` on any failure.

## Cache

Los resultados se cachean en dos capas:

1. **LRU en memoria** (300 entradas): re-hover = ~0 ms. Se limpia con `clearMemEnrichmentCache()` cuando el usuario borra la caché desde la UI.
2. **IndexedDB** tabla `vip_cache`: TTL configurable en Settings (default 14 días).

**Clave de caché:** `<tier>|<purpose>|<sourceLang>|<targetLang>|<lower-token>`. Incluye `tier` y `purpose` para evitar que una entrada Standard satisfaga una consulta VIP, o que una entrada `popover` (sin imágenes) satisfaga una consulta `card`.

**Gestión desde la UI:** Settings → Enriquecimiento → panel `CacheManager` muestra estadísticas por bucket (enrichment, translation, AI, media) con número de filas y tamaño aproximado. El botón "Limpiar caché" pide confirmación y explica qué se borra. Los mensajes SW `GET_CACHE_STATS` / `CLEAR_CACHE` son manejados por `src/background/cache-admin.ts`.

## End-to-end card simulation (2026-05-23, actualizado)

Tested against both flows using **all** Standard resources (bundled JSONs, Yomitan packs, free APIs, translator chain) plus AI off.

### Test corpus (20 palabras × 11 campos)

| Word | Type |
|---|---|
| apple | concrete noun |
| freedom | abstract noun |
| run | common verb (polysemous) |
| look up | phrasal verb |
| kick the bucket | idiom |
| lit | modern slang |
| big deal | compound MWE |
| tensor | technical noun |
| serendipity | abstract noun |
| nevertheless | connector |
| … (20 total) | … |

### Results

| Tier | Raw scoring | Fair scoring |
|---|---|---|
| **Standard** (20 fuentes) | 87.3 % | **98.6 %** |
| **VIP** (Standard + 13 fuentes) | 90.9 % | **100 %** |
| **Δ** | +3.6 pp | +1.4 pp |

### Tier composition

**Standard tier (20 fuentes — free, no token, no commercial-dict scraping):**

1. Bundled JSONs (en.json + en-extensions + en-idioms + en-cefr + MWEs + collocations + thesaurus)
2. Yomitan packs (`kty-en-es`, `kty-es-en`, `kty-en-en`, `kty-es-es`, `kty-en-ipa`)
3. free-dictionary (`api.dictionaryapi.dev`)
4. datamuse (`api.datamuse.com`)
5. wiktionary-rest (REST API)
6. **wiktionary-html** (HTML parse — etymology, synonyms, antonyms, related terms)
7. wiktionary-api (freedictionaryapi.com)
8. moby-thesaurus
9. **thesaurus-com** (antonyms para sustantivos técnicos/abstractos)
10. **wordhippo** (antonyms para MWEs/phrasals/idioms)
11. **the-idioms** (etimología de idioms)
12. etymonline
13. tatoeba
14. lingua-libre
15. google-tts
16. bing-images
17. openverse
18. wikimedia-commons
19. duckduckgo-images
20. youglish

**VIP tier (13 fuentes — commercial-dict scrapes + BYOK):**

1. Cambridge English-Spanish
2. Oxford Learner's
3. Longman LDOCE
4. Collins COBUILD
5. Merriam-Webster
6. Reverso Context
7. Linguee
8. WordReference
9. SpanishDict
10. Forvo
11. Ozdic (Oxford Collocations Dictionary mirror)
12. Unsplash (BYOK, free Demo key)
13. Pixabay (BYOK optional, scrape fallback)

## Source audit (2026-05-23 — third pass, definitive)

Honest verification status of every source — what was tested live with
the word "excuse" against the real public endpoints. **Schannel TLS
(Windows curl) was used for the audit because it's a closer
fingerprint to Chrome's network stack than Node's TLS.**

| Source | Endpoint | Verified | Notes |
|---|---|:---:|---|
| free-dictionary | `api.dictionaryapi.dev` | ✅ | JSON API, no key |
| datamuse | `api.datamuse.com` | ✅ | JSON API, no key |
| cambridge | `dictionary.cambridge.org` (HTML) | ✅ | 4 audio + 18 defs + 62 trans for "excuse" |
| oxford-learners | `oxfordlearnersdictionaries.com` (HTML) | ✅ | 16 examples + 5 collocations |
| longman | `ldoceonline.com` (HTML) | ✅ | 18 collocation flags + 33 examples |
| collins | `collinsdictionary.com` (HTML) | ✅ | 37 defs + 32 examples + 74 audio (Cloudflare passes Schannel) |
| merriam-webster | `merriam-webster.com` (HTML) | ✅ | 26 def fragments + 1 etymology |
| linguee | `linguee.com` (HTML) | ✅ | 41 dictLink translations |
| wordreference | `wordreference.com` (HTML) | ✅ | 38 ToWrd + 18 example pairs |
| wikimedia-commons | `commons.wikimedia.org/w/api.php` | ✅ | 4 image hits per query |
| lingua-libre | Commons file search | ✅ | 4 native-speaker .wav per word |
| google-tts | `translate.google.com/translate_tts` | ✅ | Streams MP3, no key |
| youglish | URL only — no fetch | ✅ | Trivial — emits the search URL |
| **tatoeba** | `tatoeba.org/api_v0/search` | ✅ | Fixed — was using a 404 URL. 6 sentence pairs per query |
| **ozdic** | `ozdic.com/api/search` | ✅ | Fixed — JSON endpoint, top-level `collocations[].groups[].clusters[]`. 41 collocations for "excuse" |
| **spanishdict** | `spanishdict.com/translate/<word>` | ✅ | Fixed — `__NEXT_DATA__` removed by site, now parses `<td class='quickdef'>`. 7 translations |
| **etymonline** | `etymonline.com/word/<word>` | ✅ | Fixed — markup migrated from `word__defination` to `<section class='prose-lg'>`. 2 paragraphs |
| **forvo** | `forvo.com/word/<word>` | ✅ | Fixed — old base64 path returned 404 since 2023; correct URL is `audio00.forvo.com/audios/mp3/<arg5>`. MP3 verified to play |
| **reverso** | `context.reverso.net/translation/...` (HTML) | ✅ | Fixed — POST `bst-query-service` returns empty `list:[]` cross-origin; HTML page ships 13+ pairs as `<div class="example">` with `src/trg` siblings |
| **duckduckgo-images** | `duckduckgo.com/i.js` | ✅ | Fixed — needs `Sec-Fetch-Dest/Mode/Site` headers (DDG bot-detection layer added in 2025). With them: ~90 images per query |
| **pixabay** | `pixabay.com/images/search/` (HTML) + optional API | ✅ | Works fine via Schannel TLS; BYOK API key option added for higher reliability and image volume |
| **bing-images** *(new)* | `bing.com/images/async` | ✅ | New source — ~25 cards per query, no token, mixed-license images. Best for "find the most relevant photo" |
| **openverse** *(new)* | `api.openverse.org/v1/images/` | ✅ | New source — CC-licensed (Flickr + Wikimedia + museums), no token, ~240 results per query |
| **wiktionary-html** *(new)* | `en.wiktionary.org/wiki/<word>` (HTML) | ✅ | Parsea etymology + synonyms + antonyms + related terms del HTML. Scoped a la sección English para evitar contaminación de otros idiomas. Fallback phrasal para verbos frasales. Retry en cold cache (body < 1000 chars). |
| **thesaurus-com** *(new)* | `www.thesaurus.com/browse/<word>` (HTML) | ✅ | Antónimos para sustantivos técnicos/abstractos. Autocorrect guard: si el headword de la página difiere del token, se descarta el resultado. CORS fix: añadido `dictionary.com` a `host_permissions` (redirect). |
| **wordhippo** *(new)* | `www.wordhippo.com/what-is/the-opposite-of/<word>.html` (HTML) | ✅ | Antónimos para MWEs, phrasals e idioms donde thesaurus.com no tiene cobertura. |
| **the-idioms** *(new)* | `www.theidioms.com/<slug>/` (HTML) | ✅ | Etimología de idioms. Complementa Etymonline para expresiones fijas. |
| ~~unsplash~~ scrape | `unsplash.com/s/photos/...` | ❌ | Discontinued (Anubis JS-challenge gate blocks all server-side / SW fetches) |
| **unsplash (BYOK)** *(redesigned)* | `api.unsplash.com/search/photos` | ✅ | Now requires the user's free Demo key (50 req/h, no credit card). Without key: source is inactive |

### Why TLS fingerprint matters

Sites with bot-protection (Cloudflare, Anubis, custom challenges) often
filter clients by their TLS handshake fingerprint (JA3). Node.js has a
distinctive fingerprint that gets blocked frequently; curl with
Schannel matches Chrome closely. The MV3 service worker uses Chrome's
real network stack so it inherits cookies + a normal `chrome-extension://`
origin. Bottom line: an audit done from Node may show 403s that the
extension SW will never hit.

### BYOK image keys (free, no credit card)

Two image sources benefit from a one-time BYOK signup:

| Provider | Free tier | Endpoint | Get key |
|---|---|---|---|
| Unsplash | 50 req/h Demo (5000 with Production approval) | `api.unsplash.com/search/photos` | https://unsplash.com/developers |
| Pixabay | 100 req/min, 5000/h | `pixabay.com/api/?key=...` | https://pixabay.com/api/docs/ |

Keys are stored encrypted at rest (AES-GCM via `secret-store.ts`) in
`chrome.storage.sync` alongside the OpenAI / Anthropic / DeepL keys.
The orchestrator passes them through the `EnrichmentContext` so each
source picks them up at call time.

## Performance

### Streaming resolution

La arquitectura de port (`kvl-resolve-word`) garantiza que el fold esencial del popover se pinte en < 1 s:

- **Palabras bundled**: la fase `local` resuelve en < 1 ms. El skeleton desaparece antes de que el usuario note que existía.
- **Palabras desconocidas**: el skeleton dura ~translation-latency (~200–500 ms), que es el tiempo de la primera llamada de red.
- **Enriquecimiento**: llega en segundo plano sin bloquear la UI. El footer "buscando más…" indica que el proceso sigue.

### Purpose-based enrichment

El orquestador acepta un parámetro `purpose`:

| Purpose | Comportamiento | Ganancia |
|---|---|---|
| `'popover'` | Excluye 6 fuentes de imagen (Bing, Openverse, Wikimedia, DDG, Pixabay, Unsplash) + cap de timeout a 2.5 s | ~37 % más rápido |
| `'card'` | Todas las fuentes + timeout completo | Máxima cobertura |

### Traductor en carrera

`callChainRaced()` en `translate-providers.ts` lanza MyMemory y Lingva en paralelo y usa el primero que responde con éxito. Elimina la latencia de esperar al primero si falla.

### Caché LRU en memoria

300 entradas en memoria delante de IndexedDB. Re-hover de la misma palabra = ~0 ms, sin acceso a disco. La caché se invalida cuando el usuario limpia desde la UI (`clearMemEnrichmentCache()`).

### Cobertura medida (corpus 20 palabras × 11 campos)

| Tier | Fair scoring |
|---|---|
| Standard (20 fuentes) | **98.6 %** |
| VIP (Standard + 13 fuentes) | **100 %** |

## AI provider audit (Gemini, OpenAI, Anthropic)

Verified 2026-05-23 with `gemini-2.5-flash` and a real card prompt:

- ✅ `gemini-2.5-flash` — current Google AI default. Returns
  386–445 tokens per enrichment, 0 thinking tokens (we send
  `thinkingConfig.thinkingBudget = 0` to skip the thinking phase).
  JSON shape complete for `excuse`, `big girl`, `pee`.
- ❌ `gemini-1.5-flash` — deprecated by Google in 2026-Q1, returns 404.
  Old default replaced.
- ⚠️ `gemini-2.0-flash` — rate-limited (429) on the free tier. Listed
  in the picker for users who hit quota on 2.5.

Defaults updated:

- `src/shared/ai-presets.ts` → Gemini default model = `gemini-2.5-flash`
- `src/shared/ai-models.ts` → picker shows 2.5/3.0/3.5 family models
- `src/background/ai-providers.ts` → `callGemini()` always sends
  `maxOutputTokens: 1500` + `thinkingConfig.thinkingBudget: 0`

### AI granular controls

| Flag | Default | Effect |
|---|---|---|
| `enrichOnHover` | false | Fire AI on every popover hover |
| `enrichOnSave` | false | Fire AI when the user saves a card |
| `preferAiMnemonic` | true | When false, Etymonline / bundled mnemonic wins over LLM paraphrase |
| `preferAiEtymology` | true | When false, Etymonline scrape wins over LLM paraphrase |
| `enableDalleFallback` | **false (opt-in)** | DALL-E 3 generates the card image only when no free source returned a photo. Costs ~$0.04 per card. Only effective when provider = `openai` |

**Why DALL-E is opt-in:** previous behaviour was implicit ("DALL-E
runs whenever you have OpenAI configured + enrichOnSave + image field
mapped + chain returned no photo"). That's a surprise charge waiting
to happen. The 2026-05-23 audit moved this behind an explicit toggle
so users have to consciously enable paid image generation.

## Translator chain (offline → free → premium)

| Provider | Tier | Notes |
|---|---|---|
| `offline` (bundled dict) | Always tried first | < 1 ms, zero network |
| `mymemory` | Free | 5000 chars/day anon (`api.mymemory.translated.net`); 50000 with email override. Returns ranked translations + quality scores |
| `lingva` | Free | Default host updated to `https://lingva.ml` (the previous default `lingva.thedaviddelta.com` is `DEPLOYMENT_PAUSED`). Auto-fallback to `translate.plausibility.cloud` and `lingva.lunar.icu` when the configured host returns 5xx |
| `libretranslate` | Free / paid | Public host requires API key now (anon = 400). For self-hosted Docker setups, point `libreTranslateUrl` at `http://localhost:5000`. Not recommended for personal use (3.7 GB Docker image, 4 GB RAM minimum) |
| `deepl` | BYOK | Free tier 500 000 chars/month |
| `google` | BYOK | Cloud Translate v2/v3 |

Selection strategy is `mode: 'chain'` by default — walks
`offline → free → premium` and uses the first successful result.
Power users can switch to `mode: 'single'` to lock onto one provider.

## When something breaks

A source's HTML changes? Symptoms:
  - Popover renders fewer fields than usual.
  - Settings → "VIP" expanded shows the source's checkbox checked.
  - DevTools network panel shows the request returned 200 but the
    extracted partial is empty.

Fix:
1. Open the source page in a regular browser tab.
2. Use DevTools → Elements to find the new class names / attributes.
3. Update the regex selectors in
   `src/background/enrichment/sources/<source>.ts`.
4. Add a comment with the date you verified the markup, like the
   existing files. The pattern of fail-silent + per-source toggle
   means a broken source doesn't kill the rest.

## Adding a new source

1. Create `src/background/enrichment/sources/<name>.ts` exporting an
   `EnrichmentSource`.
2. Add a new key to `VipSettings` in `src/shared/types.ts` with a
   sensible default in `DEFAULT_VIP` (`store.ts`).
3. Register it in the `VIP_SOURCES` map of
   `src/background/enrichment/orchestrator.ts`.
4. Add a checkbox in `src/app/components/tabs/VipSection.tsx` under
   the right `SubGroup`.
5. Add a label in `formatSource()` of `src/content/ui/WordPopover.tsx`.
6. Add the host to `manifest.json` `host_permissions`.

## Anki field sources

`FieldSource` enum in `src/shared/types.ts` lets the user map any
note field to one of:

| Source | Filled by |
|---|---|
| `selection`, `cue` | request itself (token + sentence) |
| `phonetic` | local OR enriched (Cambridge → Oxford → FreeDict → IPA pack) |
| `translation`, `bilingual`, `monolingual` | local + enriched chain (Reverso / WordReference / SpanishDict / Cambridge / Linguee for translation; Longman / Cambridge / Oxford / Collins / M-W / FreeDict for monolingual) |
| `examples` | local OR enriched (Reverso / Linguee / WordRef / Cambridge / Tatoeba / Ozdic) |
| `synonyms` | bundled Fernald thesaurus + Datamuse + Cambridge thesaurus + Wiktionary HTML |
| `antonyms` | bundled Fernald thesaurus + Datamuse + **Wiktionary HTML** + **thesaurus.com** (sustantivos técnicos/abstractos) + **WordHippo** (MWEs/phrasals/idioms) |
| `collocations` | bundled Academic Collocation List + Datamuse + Cambridge / Oxford Learner's / **Ozdic (OCD)** / Longman + **Wiktionary HTML** (related terms) |
| `etymology` | **Wiktionary HTML** + Etymonline + **The Idioms** (idiom etymology) + AI (gated by `preferAiEtymology`) |
| `mnemonic` | AI (gated by `preferAiMnemonic`) |
| `image` | Bing → Openverse → Pixabay → Wikimedia → DDG → Unsplash (BYOK) → DALL-E 3 (opt-in fallback) |
| `frame` | live video frame, falls back to `image` URL when frame is missing |
| `sentence-audio` | live tab capture (or sentence TTS) |
| `word-audio` | Forvo → Cambridge → Oxford → Lingua Libre → Wikimedia → Google TTS |
| `video-link` | YouGlish |
| `ai-*` | OpenAI / Anthropic / Gemini |
