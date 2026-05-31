# Multi-source enrichment — Standard + VIP

How Kivara Lingo populates the popover and the Anki card with rich
data from up to 30 dictionaries / scrapes / image sources without
needing any API key from the user.

## Tier overview

| Tier | Always on? | Sources |
|---|---|---|
| **Local** | ✅ | Bundled `en.json` + `en-extensions` + Oxford 3000/5000 CEFR + Oxford Phrasal Academic Lexicon + Academic Collocation List + Fernald Thesaurus 1896 + Yomitan packs (`kty-en-es`, `kty-en-en`, `kty-en-ipa`, `kty-es-en`, `kty-es-es`) |
| **Standard** | ✅ | Free Dictionary API · Datamuse · Wiktionary REST · **Wiktionary HTML** (etymology + synonyms + antonyms + related terms para frases multi-palabra) · WiktionaryAPI (freedictionaryapi.com mirror) · Moby Thesaurus · Bundled · Yomitan packs · Etymonline · Tatoeba · Lingua Libre · Google TTS · Bing Images · Openverse · Wikimedia Commons · DuckDuckGo Images · YouGlish |
| **VIP** | toggle in Settings | Cambridge · Oxford Learner's · Longman · Collins · Merriam-Webster · **Ozdic (Oxford Collocations)** · Reverso · Linguee · WordReference · SpanishDict · Forvo · **Unsplash (BYOK)** · **Pixabay (BYOK opt.)** |
| **AI** | toggle + API key | OpenAI / Anthropic / Gemini — generates contextual definition, synonyms, collocations, register, **mnemonic**, **etymology**, and **DALL-E 3 image** (OpenAI only, opt-in via `enableDalleFallback`, ~$0.04/card) |

Every source is independent: a Cambridge timeout never blocks Reverso.
Failures are silent — the popover just renders less.

## The flow

```
hover token / save card
        │
        ▼
RESOLVE_WORD or createCardFromRequest
        │
        ├── 1. Local (sync, < 1 ms)
        │    bundled + Yomitan packs (lemma-aware)
        │
        ├── 2. runEnrichment(token, ctx)  (parallel, ~300-2000 ms)
        │    fan-out across enabled sources
        │       ├── freeDictionarySource         ← Standard
        │       ├── datamuseSource               ← Standard
        │       └── (vip) cambridgeSource, oxford..., longman..., etc.
        │    merge → { entry, vip, successfulSources, failedSources }
        │
        └── 3. AI (only if `enrichOnHover` / `enrichOnSave`)
             generates mnemonic + etymology + register
             patches `entry.vip`, gated by `preferAiMnemonic` /
             `preferAiEtymology` so the user can keep Etymonline's
             scrape over the LLM paraphrase.
```

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

Seven bundled JSONs ship with the extension (no download, no network).
They merge into `dictionary.ts` at module load time so the popover
has rich data even with VIP off and zero internet.

| File | Entries | Source | What it adds |
|---|---|---|---|
| `src/assets/dictionaries/en.json` | 4 151 | Curated (audited 2026-05) | Translation, bilingual, monolingual (≤360 chars), IPA, level, examples |
| `src/assets/dictionaries/en-extensions.json` | 357 | Hand-curated | Phrasal verbs + idioms + cognates missed by the bundle |
| `src/assets/dictionaries/en-cefr.json` | 4 951 | Oxford 3000 + 5000 (jnoodle/English-Vocabulary-Word-List) | `level: A2 \| B2` overlay |
| `src/assets/mwes/en.json` | 150 | Hand-curated | Common MWE entries |
| `src/assets/mwes/en-phrasal-academic.json` | 673 | Oxford Phrasal Academic Lexicon | Academic phrases tokenized as MWE (translation field is `—` placeholder by design) |
| `src/assets/collocations/academic-collocation-list.json` | 472 | Ackermann & Chen 2013 (open access) | `collocations` overlay |
| `src/assets/thesaurus/en-thesaurus.json` | 611 | Fernald 1896 (public domain) | `synonyms` + `antonyms` overlay (uses `syn`/`ant` keys internally) |

Total bundle weight: ~2.5 MB raw, ~250 KB gzipped.

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

Results are cached in IndexedDB v5 table `vip_cache` keyed by
`<sourceLang>|<targetLang>|<lower-token>`. TTL configurable in
Settings (default 14 days).

## End-to-end card simulation (2026-05-23)

Tested 7 words spanning all major lexical categories against both
flows, using **all** Standard resources (bundled JSONs, Yomitan packs,
free APIs, translator chain) plus AI off so the comparison is honest.

### Test corpus

| Word | Type |
|---|---|
| apple | concrete noun |
| freedom | abstract noun |
| run | common verb (polysemous) |
| look up | phrasal verb |
| kick the bucket | idiom |
| lit | modern slang |
| big deal | compound MWE |

### Two scoring methods

**Raw (universal 11 fields):** counts how many of the 11 possible
fields (Phonetic, Translation, Bilingual, Monolingual, Examples,
Synonyms, Antonyms, Collocations, Etymology, Image, Word audio) are
filled. Penalises words for missing fields that don't apply (e.g.
"antonyms of apple" — apple doesn't have an opposite).

**Fair (applicable fields only):** counts only fields that are
linguistically expected for the word type. Concrete nouns don't have
antonyms; idioms don't have indexable etymology in Etymonline;
phrasals don't have collocations as a fixed-phrase category.

### Results

| Tier | Raw scoring | Fair scoring |
|---|---|---|
| **Standard** (bundled + Yomitan + free APIs) | 85.7 % | **98.4 %** |
| **VIP** (Standard + commercial-dict scrapes) | 88.3 % | **100 %** |
| **Δ** | +2.6 pp | +1.6 pp |

### Tier composition

**Standard tier (free, no token, no commercial-dict scraping):**

1. Bundled JSONs (4 151 + 357 + 4 951 + 150 + 673 + 472 + 611 entries)
2. Yomitan packs (`kty-en-es`, `kty-es-en`, `kty-en-en`, `kty-es-es`,
   `kty-en-ipa`)
3. Free Dictionary API (`api.dictionaryapi.dev`)
4. Datamuse (`api.datamuse.com`)
5. Tatoeba (`tatoeba.org/api_v0/search`)
6. Lingua Libre (Wikimedia file-search)
7. Wikimedia Commons (image search)
8. Etymonline (etymology scrape, no commercial dict)
9. Bing Images (web search)
10. Openverse (CC-licensed images)
11. DuckDuckGo Images
12. YouGlish (URL only)
13. Google TTS fallback (synthetic audio)
14. MyMemory (translator chain)
15. Lingva (translator chain, multi-mirror)

**VIP tier (commercial-dict scrapes + BYOK):**

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
| `synonyms` | bundled Fernald thesaurus + Datamuse + Cambridge thesaurus |
| `antonyms` | bundled Fernald thesaurus + Datamuse |
| `collocations` | bundled Academic Collocation List + Datamuse + Cambridge / Oxford Learner's / **Ozdic (OCD)** / Longman |
| `etymology` | Etymonline + AI (gated by `preferAiEtymology`) |
| `mnemonic` | AI (gated by `preferAiMnemonic`) |
| `image` | Bing → Openverse → Pixabay → Wikimedia → DDG → Unsplash (BYOK) → DALL-E 3 (opt-in fallback) |
| `frame` | live video frame, falls back to `image` URL when frame is missing |
| `sentence-audio` | live tab capture (or sentence TTS) |
| `word-audio` | Forvo → Cambridge → Oxford → Lingua Libre → Wikimedia → Google TTS |
| `video-link` | YouGlish |
| `ai-*` | OpenAI / Anthropic / Gemini |
