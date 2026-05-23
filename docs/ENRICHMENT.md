# Multi-source enrichment — Standard + VIP

How Kivara Lingo populates the popover and the Anki card with rich
data from up to 20 dictionaries / scrapes / image sources without
needing any API key from the user.

## Tier overview

| Tier | Always on? | Sources |
|---|---|---|
| **Local** | ✅ | Bundled `en.json` + `en-extensions` + Oxford 3000/5000 CEFR + Oxford Phrasal Academic Lexicon + Academic Collocation List + Fernald Thesaurus 1896 + Yomitan packs (`kty-en-es`, `kty-en-en`, `kty-en-ipa`) |
| **Standard** | ✅ | Free Dictionary API · Datamuse |
| **VIP** | toggle in Settings | Cambridge · Oxford Learner's · Longman · Collins · Merriam-Webster · **Ozdic (Oxford Collocations)** · Reverso · Linguee · WordReference · SpanishDict · **Tatoeba** · Forvo · Lingua Libre · Etymonline · Unsplash · Pixabay · Wikimedia Commons · DuckDuckGo Images · YouGlish · Google TTS fallback |
| **AI** | toggle + API key | OpenAI / Anthropic / Gemini — generates contextual definition, synonyms, collocations, register, **mnemonic**, **etymology**, and **DALL-E 3 image** (OpenAI only, save-time only, ~$0.04/card) |

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
        │    bundled + Yomitan packs
        │
        ├── 2. runEnrichment(token, ctx)  (parallel, ~300-2000 ms)
        │    fan-out across enabled sources
        │       ├── freeDictionarySource
        │       ├── datamuseSource
        │       └── (vip) cambridgeSource, oxford..., longman..., etc.
        │    merge → { entry, vip, successfulSources, failedSources }
        │
        └── 3. AI (only if `enrichOnHover` / `enrichOnSave`)
             generates mnemonic + etymology + register
             patches `entry.vip`
```

## Where the user controls each tier

| Tier | UI location | Toggle behaviour |
|---|---|---|
| **Bundled overlays** | Settings → "Enriquecimiento (Standard + VIP)" → top info panel (read-only) | Always active. Shipped with the extension as ~250 KB of JSON. |
| **Yomitan packs** | Settings → "Diccionarios offline" | Each pack has `Instalar` / `Eliminar` / on/off toggle. |
| **Standard tier** (Free Dictionary + Datamuse) | Settings → "Enriquecimiento" → "Estándar (gratis, siempre activo)" | Both default-on. Each source individually disable-able from a checkbox. Runs **regardless** of VIP master switch. |
| **VIP tier** (18 scrape sources) | Settings → "Enriquecimiento" → master toggle → groups | Master switch off by default. Once on, every source defaults on with individual checkboxes grouped by category. |
| **AI** | Settings → "IA premium" | Provider + API key selector. `enrichOnHover` / `enrichOnSave` flags decide when to fire. |

## Bundled offline assets

Six bundled JSONs ship with the extension (no download, no network).
They merge into `dictionary.ts` at module load time so the popover
has rich data even with VIP off and zero internet.

| File | Entries | Source | What it adds |
|---|---|---|---|
| `src/assets/dictionaries/en.json` | 4 151 | Curated (audited 2026-05) | Translation, bilingual, monolingual, IPA, level, examples |
| `src/assets/dictionaries/en-extensions.json` | ~250 | Hand-curated | Phrasal verbs + idioms missed by the bundle |
| `src/assets/dictionaries/en-cefr.json` | 4 950 | Oxford 3000 + 5000 (jnoodle/English-Vocabulary-Word-List) | `level: A2 \| B2` overlay |
| `src/assets/mwes/en.json` | ~150 | Hand-curated | Common MWE entries |
| `src/assets/mwes/en-phrasal-academic.json` | 672 | Oxford Phrasal Academic Lexicon | Academic phrases tokenized as MWE |
| `src/assets/collocations/academic-collocation-list.json` | 2 469 | Ackermann & Chen 2013 (open access) | `collocations` overlay |
| `src/assets/thesaurus/en-thesaurus.json` | 610 | Fernald 1896 (public domain) | `synonyms` + `antonyms` overlay |

Total bundle weight: ~2.5 MB raw, ~250 KB gzipped — negligible
overhead in the extension package.

To regenerate after upstream updates:
```bash
node .tmp-build-bundles.cjs   # Oxford 3000/5000 + Phrasal
node .tmp-build-thesaurus.cjs # Fernald thesaurus
```
(Scripts are deleted after each release; the JSONs are committed.)

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

## Source audit (2026-05-22 — second pass)

Honest verification status of every source — what was tested live with
the word "excuse" against the real public endpoints, **and what changed
between the first audit and the second**.

| Source | Endpoint | Verified | Notes |
|---|---|:---:|---|
| free-dictionary | `api.dictionaryapi.dev` | ✅ | JSON API, no key |
| datamuse | `api.datamuse.com` | ✅ | JSON API, no key |
| cambridge | `dictionary.cambridge.org` (HTML) | ✅ | 4 audio + 18 defs + 62 trans for "excuse" |
| oxford-learners | `oxfordlearnersdictionaries.com` (HTML) | ✅ | 16 examples + 5 collocations |
| longman | `ldoceonline.com` (HTML) | ✅ | 18 collocation flags + 33 examples |
| collins | `collinsdictionary.com` (HTML) | ✅ | curl with desktop UA passes; 37 defs + 32 examples + 74 audio |
| merriam-webster | `merriam-webster.com` (HTML) | ✅ | 26 def fragments + 1 etymology |
| linguee | `linguee.com` (HTML) | ✅ | 41 dictLink translations |
| wordreference | `wordreference.com` (HTML) | ✅ | 38 ToWrd + 18 example pairs |
| wikimedia-commons | `commons.wikimedia.org/w/api.php` | ✅ | 4 image hits per query |
| lingua-libre | Commons file search | ✅ | 4 native-speaker .wav per word |
| google-tts | `translate.google.com/translate_tts` | ✅ | Streams MP3, no key |
| youglish | URL only — no fetch | ✅ | trivial |
| **tatoeba** | `tatoeba.org/api_v0/search` | ✅ | **fixed (1st pass)** — was using a 404 URL |
| **ozdic** | `ozdic.com/api/search` | ✅ | **fixed (1st pass)** — was using a 404 URL; collocations live at top-level (41 collocations for "excuse") |
| **spanishdict** | `spanishdict.com/translate/<word>` | ✅ | **fixed (1st pass)** — `__NEXT_DATA__` removed by site, now parses `<td class='quickdef'>` |
| **etymonline** | `etymonline.com/word/<word>` | ✅ | **fixed (1st pass)** — markup migrated from `word__defination` to `<section class='prose-lg'>` |
| **forvo** | `forvo.com/word/<word>` | ✅ | **fixed (2nd pass)** — old base64 path returned 404 since 2023; correct URL is `audio00.forvo.com/audios/mp3/<arg5>` (not `arg2`). Verified the MP3 plays. |
| **reverso** | `context.reverso.net/translation/...` (HTML) | ✅ | **fixed (2nd pass)** — POST `bst-query-service` returns empty `list:[]` cross-origin; HTML page ships 13+ pairs as plain `<div class="example">` with `src/trg` siblings. |
| **duckduckgo-images** | `duckduckgo.com/i.js` | ✅ | **fixed (2nd pass)** — was 403; needs `Sec-Fetch-Dest/Mode/Site` headers (DDG bot-detection layer added in 2025). With them: ~90 images per query. |
| **pixabay** | `pixabay.com/images/search/` (HTML) + optional API | ✅ | **fixed (2nd pass)** — works fine via curl (Schannel TLS); BYOK API key option added for higher reliability. |
| **bing-images** *(new)* | `bing.com/images/async` | ✅ | New source — ~25 cards per query, no token, mixed-license images. |
| **openverse** *(new)* | `api.openverse.org/v1/images/` | ✅ | New source — CC-licensed (Flickr + Wikimedia + museums), no token, ~240 results per query. |
| ~~unsplash~~ scrape | `unsplash.com/s/photos/...` | ❌ | Discontinued (Anubis JS-challenge gate blocks all server-side / SW fetches). |
| **unsplash (BYOK)** *(redesigned)* | `api.unsplash.com/search/photos` | ✅ | Now requires the user's free Demo key (50 req/h, no credit card). Without key: source is inactive. |

**TLS fingerprint matters:** the first audit hit 403 on Collins / Forvo /
Reverso / Pixabay / DDG when called from Node, but the second audit
showed those sites accept curl with Schannel (Windows TLS stack) just
fine. The MV3 service worker uses Chrome's actual network stack, which
is closer to curl/Schannel than to Node's TLS — so all of these work
from the extension at runtime.

**Why Unsplash is BYOK:** Unsplash explicitly redirects every public-page
request to `/.within.website` (Anubis), an open-source JS-challenge
proxy. There's no header bundle that bypasses it short of running a
real browser. Their official Developer API is the supported path —
free, no credit card, 50 requests/hour Demo tier at
https://unsplash.com/developers. The user pastes the access key in
Settings → Enriquecimiento → "Claves API opcionales".

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

## Anki field sources

`FieldSource` enum in `src/shared/types.ts` lets the user map any
note field to one of:

| Source | Filled by |
|---|---|
| `selection`, `cue` | request itself |
| `phonetic` | local OR enriched (Cambridge / Oxford / FreeDict / IPA pack) |
| `translation`, `bilingual`, `monolingual` | local + enriched chain |
| `examples` | local OR enriched (Reverso / Linguee / WordRef / Cambridge) |
| `synonyms` | bundled Fernald thesaurus + Datamuse + WordNet pack + Cambridge thesaurus |
| `antonyms` | bundled Fernald thesaurus + Datamuse + WordNet pack |
| `collocations` | bundled Academic Collocation List + Datamuse + Cambridge / Oxford Learner's / **Ozdic (OCD)** |
| `etymology` | Etymonline + AI |
| `mnemonic` | AI |
| `image` | Unsplash → Pixabay → Wikimedia → DuckDuckGo → DALL-E 3 (paid fallback) |
| `frame` | live video frame, falls back to `image` URL |
| `sentence-audio` | live tab capture (or sentence TTS) |
| `word-audio` | Forvo → Cambridge → Oxford → Lingua Libre → Wikimedia → Google TTS |
| `video-link` | YouGlish |
| `ai-*` | OpenAI / Anthropic / Gemini |
