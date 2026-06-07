# Raw Source Audit Protocol

Last updated: 2026-06-06

## Goal

Before adding or changing any enrichment source, Kivara must capture what the source actually returns, not only what the current parser extracts. This prevents blind filters, lost data and accidental contamination of rich-card fields.

## Tool

Run:

```bash
pnpm tsx scripts/raw-source-audit.ts --tokens=give,wonderful,anything --sources=pons,dictcc,britannicaDictionary,wiktApi
```

Useful options:

```bash
# Save complete raw HTML/JSON bodies. This can be large and should not be committed casually.
FULL_RAW=1 pnpm tsx scripts/raw-source-audit.ts --full-raw

# Restrict tokens / sources.
pnpm tsx scripts/raw-source-audit.ts --tokens=give,run,break\ up --sources=cambridge,wordReference,spanishDict
```

The audit writes metadata and body samples under:

```text
docs/reports/raw-source-audit/YYYY-MM-DD/
```

Each request stores:

```text
sourceId
tier
token
url
finalUrl
status
content-type
byte size
sha256
bodySample
optional full raw path
```

## Current verified candidate results

A smoke raw audit was run for:

```text
give
wonderful
anything
```

and sources:

```text
wiktApi
babla
pons
dictcc
britannicaDictionary
```

### WiktApi

Status: usable candidate for Standard.

Observed:

```text
/v1/en/word/{word}?lang=en              -> 200 JSON
/v1/en/word/{word}/translations?lang=en -> 200 JSON
/v1/en/word/{word}/pronunciations?lang=en -> 200 JSON
```

For `give`, response sizes were roughly:

```text
full entry: 79 KB
translations: 51 KB
pronunciations: 603 B
```

Recommendation:

```text
candidate-standard
fields: monolingual, translations, examples, pronunciations, forms, etymology
priority: strong replacement/supplement for fragile Wiktionary parsing
```

### PONS

Status: strong VIP candidate.

Observed:

```text
give       -> 200, ~2.25 MB HTML
wonderful  -> 200, ~478 KB HTML
anything   -> 200, ~807 KB HTML
```

Raw page contains Oxford Spanish Dictionary sections with:

```text
sense groups
POS
IPA/audio icons
single-word translations
collocation-like phrase patterns
aligned example translations
regional labels
formal/informal labels
```

Recommendation:

```text
candidate-vip
fields: bilingual, examples, sense groups, audio metadata
parser requirement: must preserve sense groups and separate headword glosa from example phrases
```

### dict.cc

Status: useful VIP candidate / secondary bilingual source.

Observed:

```text
give       -> 200, ~83 KB HTML
wonderful  -> 200, ~47 KB HTML
anything   -> 200, ~53 KB HTML
```

Raw page contains:

```text
translation tables
word class rows
subject/domain labels
phrase rows
idiom rows
audio/info icons
```

Recommendation:

```text
candidate-vip
fields: bilingual, phrase translations, domain labels
parser requirement: split single-word rows from phrase/idiom rows; do not dump all rows into bilingual
```

### Britannica Dictionary

Status: strong Standard candidate for learner monolingual.

Observed:

```text
give       -> 200, ~349 KB HTML
wonderful  -> 200, ~36 KB HTML
anything   -> 200, ~77 KB HTML
```

Raw page contains:

```text
simple learner definitions
many examples
phrasal verbs
idioms
pronunciations
entry list / related entries
```

Recommendation:

```text
candidate-standard
fields: monolingual, examples, phrasal verbs, idioms, pronunciation
priority: should improve Standard monolingual quality, especially when FreeDictionary chooses the wrong sense
```

### bab.la

Status: strong VIP candidate, parser still required before integration.

Initial Node/browser-like headers returned:

```text
403, ~5.9 KB Cloudflare body
```

After protocol testing, bab.la returned full static dictionary HTML with crawler-compatible headers:

```text
give       -> 200, ~1.15 MB HTML
wonderful  -> 200, ~814 KB HTML
anything   -> 200, ~706 KB HTML
```

The raw page contains:

```text
top translation
POS sections
large bilingual translation lists
Oxford-powered detailed dictionary sections
examples with aligned translations
idioms
phrasal verbs
conjugation links
regional/register labels
```

Recommendation:

```text
candidate-vip
fields: bilingual, examples, idioms, phrasal verbs, sense groups
parser requirement: must separate compact lexical glosses from corpus examples and long Oxford sections
runtime requirement: verify the same request behavior from MV3 service worker before enabling by default
```

## GitHub / community evidence

Research found existing public scraper/client work that can guide parsers but must not be copied blindly:

- Cambridge has GitHub topics and scraper projects, including Python parsers and Node API experiments.
- Linguee has community HTML-to-JSON proxies and scrapers.
- WordReference has Emacs clients and community discussions noting scraping is needed because public API access is no longer generally available.
- PONS has an unofficial Python client that scrapes the HTML page.
- dict.cc has CLI/add-on/scraper examples and downloadable dictionary ecosystem.

These references confirm that scraping these sites is technically feasible, but Kivara must validate current HTML responses with `scripts/raw-source-audit.ts` before integration.

## Integration gate

A new source may be integrated only after:

1. Raw audit returns stable 200/JSON or 200/HTML from Node and preferably from extension runtime.
2. Parser snapshot shows every extracted field and every discarded block with reason.
3. Source mapping document exists under `docs/sources/{source}.md`.
4. It improves at least one rich-card field over current sources.
5. It does not slow first paint. New sources must run in enrichment fan-out, never before local first paint.
6. It does not overwrite existing fields with untyped raw text.

## Candidate priority after raw audit

1. **WiktApi / Kaikki-backed JSON** for Standard structured Wiktionary data.
2. **PONS** for VIP bilingual/sense-group/examples.
3. **Britannica Dictionary** for Standard learner monolingual/examples.
4. **dict.cc** for VIP/secondary bilingual and phrase rows.
5. **bab.la** for VIP bilingual/idioms/phrasals after parser snapshots and MV3 runtime verification.

## Open work

- Add extension-runtime audit command to compare Node vs MV3 service worker behavior.
- Add per-source docs for current sources, not just candidates.
- Add parser snapshots for PONS, bab.la, dict.cc, Britannica and WiktApi before integrating them.
- Keep all existing sources. New sources must supplement coverage, not replace the current Standard/VIP fan-out.
