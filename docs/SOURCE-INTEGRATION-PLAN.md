# Source Integration Plan

Last updated: 2026-06-07

## Objective

Improve rich-card quality without losing first-paint speed and without adding any source blindly. Every new source must pass this chain:

```text
raw response -> parser snapshot -> source doc -> field mapping -> ranker rule -> final card QA
```

No source is integrated directly from a website impression or from a community scraper. Community scrapers are references only.

## Preserve the current speed model

The existing progressive model must not be broken:

1. Local/bundled/imported dictionaries provide fast first paint and offline fallback.
2. Standard online fan-out enriches the card after first paint.
3. VIP fan-out provides higher-quality bilingual, learner definitions, examples and audio.
4. Save-to-Anki uses `purpose: card` and should use the best validated merged candidate available.

New sources must run inside the fan-out. They must never block local first paint.

## Candidate source order

### Standard candidates

1. **WiktApi**
   - Structured Wiktionary/Kaikki JSON.
   - Use for translations, definitions, examples, pronunciations, forms and etymology.
   - Good replacement/supplement for fragile Wiktionary HTML extraction.

2. **Britannica Dictionary**
   - Learner monolingual definitions and examples.
   - Use to improve Standard `monolingual`, especially when FreeDictionary picks the wrong sense.

### VIP candidates

1. **PONS**
   - Highest candidate priority for VIP bilingual/sense-group/examples after parser validation.
   - Raw pages are large and rich, with Oxford Spanish Dictionary sections.

2. **bab.la**
   - High candidate priority for VIP bilingual, examples, idioms and phrasal verbs.
   - Requires crawler-compatible headers and MV3 runtime verification.

3. **dict.cc**
   - Secondary VIP bilingual/phrase/domain-label source.
   - Useful fallback, but should not outrank PONS/bab.la/Cambridge/SpanishDict/WordReference for main gloss.

## Field-specific ranking targets

### `bilingual`

Goal: compact word/phrase gloss. No examples, no sentences, no grammar-label noise.

Target VIP ranking after validation:

```text
PONS / bab.la / Cambridge / SpanishDict / WordReference / dict.cc / Linguee-Reverso fallback
```

Target Standard ranking after validation:

```text
WiktApi / FreeDict-Apertium future / local imported / bundled fallback / MT fallback
```

### `monolingual`

Goal: learner-appropriate source-language definition matching the context.

Target ranking:

```text
Longman / Oxford Learners / Cambridge / Britannica / Merriam-Collins / WiktApi / FreeDictionary / Wiktionary
```

### `examples`

Goal: short, natural examples, preferably aligned with translation when available.

Target ranking:

```text
PONS / bab.la / Cambridge / Longman / Oxford / Tatoeba / Wiktionary / FreeDictionary
```

### `collocations`

Goal: useful learner chunks, not generic n-grams.

Target ranking:

```text
Ozdic / Oxford-Longman-Cambridge usage / PONS-bab.la phrase sections / dict.cc phrase rows / Datamuse only after strict filtering
```

### `word audio`

Goal: native audio when possible, reliable fallback otherwise.

Target ranking:

```text
Forvo / Oxford-Cambridge-Longman / FreeDictionary / LinguaLibre / Google TTS fallback
```

## Integration gates

A source can be integrated only if all are true:

1. Raw audit returns stable `200` or documented recoverable behavior.
2. Parser snapshot identifies useful fields and dangerous blocks.
3. Source doc exists in `docs/sources/`.
4. Parser keeps examples/phrases separate from main bilingual gloss.
5. Parser has sample outputs for single word, polysemy, pronoun, noun, verb, phrasal verb and idiom where applicable.
6. Runtime MV3 verification passes for sources with special headers/protocols.
7. It improves at least one field without increasing hover first-paint latency.

## Final QA matrix before enabling new sources

The final quality test must cover:

```text
give
wonderful
anything
anybody
week
know
run
set
mean
right
look up
break up
get over
piece of cake
make a decision
take care of
```

For each token, print:

```text
Standard card
VIP card
field value
winning source
runner-up candidates
discarded candidates with reason
latency per source
quality assessment
```

Only after that test should new sources be enabled by default.
