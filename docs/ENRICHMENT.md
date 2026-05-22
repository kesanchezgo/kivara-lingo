# Multi-source enrichment — Standard + VIP

How Kivara Lingo populates the popover and the Anki card with rich
data from up to 20 dictionaries / scrapes / image sources without
needing any API key from the user.

## Tier overview

| Tier | Always on? | Sources |
|---|---|---|
| **Local** | ✅ | Bundled `en.json` + `en-extensions` + ACL collocations + Yomitan packs (`kty-en-es`, `kty-en-en`, `kty-en-ipa`) |
| **Standard** | ✅ | Free Dictionary API · Datamuse |
| **VIP** | toggle in Settings | Cambridge · Oxford Learner's · Longman · Collins · Merriam-Webster · Reverso · Linguee · WordReference · SpanishDict · Forvo · Lingua Libre · Etymonline · Unsplash · Pixabay · Wikimedia Commons · DuckDuckGo Images · YouGlish · Google TTS fallback |
| **AI** | toggle + API key | OpenAI / Anthropic / Gemini — generates contextual definition, synonyms, collocations, register, **mnemonic**, **etymology** |

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
| `synonyms` | enriched (Datamuse + WordNet pack + Cambridge thesaurus) |
| `antonyms` | enriched (Datamuse + WordNet pack) |
| `collocations` | bundled ACL + Datamuse + Cambridge / Oxford |
| `etymology` | Etymonline + AI |
| `mnemonic` | AI |
| `image` | Unsplash → Pixabay → Wikimedia → DuckDuckGo |
| `frame` | live video frame, falls back to `image` URL |
| `sentence-audio` | live tab capture (or sentence TTS) |
| `word-audio` | Forvo → Cambridge → Oxford → Lingua Libre → Wikimedia → Google TTS |
| `video-link` | YouGlish |
| `ai-*` | OpenAI / Anthropic / Gemini |
