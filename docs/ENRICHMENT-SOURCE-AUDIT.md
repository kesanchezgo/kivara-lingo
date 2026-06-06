# Kivara Lingo Enrichment Source Audit

Last audit: 2026-06-06

## Purpose

This document records how every online enrichment source returns data so the rich-card merger can be improved without guessing. Offline sources (`bundled`, imported Yomitan packs) are speed/fallback layers and are not used as the quality baseline in this audit. They still remain in the runtime flow for instant first paint and offline mode.

## Runtime model to preserve

Kivara uses a progressive rich-card pipeline:

1. **Fast local paint**: bundled and imported dictionaries produce a quick card.
2. **Standard online fan-out**: free online sources enrich the card without requiring VIP.
3. **VIP fan-out**: commercial dictionary scrapes and premium sources improve translations, learner definitions, examples, IPA and audio.
4. **AI, optional**: supplements explicit AI fields and selected helper fields without replacing the source pipeline blindly.

Do not remove this model. Performance comes from first paint plus background fan-out. Quality at save-time comes from using the best merged result available, not from trusting the fastest source.

## Probe setup

A dedicated probe ran each online source individually against representative word types:

| Token | Type | Sentence |
|---|---|---|
| `give` | polysemous verb | `It's my father. He wants to give me a Mercedes convertible.` |
| `wonderful` | adjective | `Oh, yeah, last week, you had a wonderful nutty cake.` |
| `anything` | indefinite pronoun | `Does anybody want anything else?` |
| `anybody` | person pronoun | `Does anybody want anything else?` |
| `week` | time noun | `Oh, yeah, last week, you had a wonderful nutty cake.` |
| `know` | verb | `or I don't know.` |
| `break up` | phrasal verb | `They decided to break up after college.` |
| `piece of cake` | idiom | `The exam was a piece of cake.` |
| `run` | polysemous verb | `I run every morning before work.` |

The audit ran all Standard and VIP online modules directly and printed each raw `SourcePartial` shape. Offline sources were intentionally excluded from this specific online quality baseline.

## SourcePartial contract

Every source returns a subset of:

```ts
interface SourcePartial {
  definitions?: string[];
  translations?: string[];
  examples?: Array<{ text: string; translation?: string }>;
  synonyms?: string[];
  antonyms?: string[];
  collocations?: string[];
  phonetic?: string;
  audio?: Array<{ url: string; accent?: string }>;
  imageUrl?: string;
  etymology?: string;
  mnemonic?: string;
  videoLinks?: Array<{ url: string }>;
  frequencyRank?: number;
}
```

## Standard source behavior

| Source | Fields observed | Quality notes |
|---|---|---|
| `freeDictionary` | definitions, examples, synonyms, antonyms, audio, phonetic | Useful for IPA/audio/examples, but often picks wrong first sense for polysemous words (`give` as noun flexibility, `know` as noun knowledge). Do not trust first definition blindly for contextual cards. |
| `datamuse` | synonyms, antonyms, collocations | Useful for related words, but collocations are noisy n-grams (`give will`, `wonderful the`, `week a`). Must be filtered or demoted. |
| `wiktionary` | definitions, examples | Good breadth and etymological examples, but includes noisy editorial examples and broad senses. Useful after cleanup. |
| `wiktionaryHtml` | etymology, collocations | Etymology useful. Collocations can be morphological/related terms, not always learner collocations. |
| `wiktionaryApi` | definitions, examples, synonyms, antonyms, phonetic | Similar to Wiktionary with cleaner API shape. Needs sense/context ranking. |
| `mobyThesaurus` | synonyms | Very broad thesaurus, high recall, noisy. Should feed secondary synonym pool only. |
| `thesaurusCom` | synonyms, antonyms | Useful, less noisy than Moby but still broad. |
| `wordHippo` | antonyms, sometimes translations-like pages depending word | Useful for antonyms. Fetch can be page-structure sensitive. |
| `theIdioms` | definitions/examples for idioms | Valuable for idioms only. Usually empty for single words. |
| `etymonline` | etymology | Good etymology, not a definition/translation source. |
| `tatoeba` | examples | Good for sentence examples if query returns. Not a lexical translation source. |
| `linguaLibre` | audio | Good pronunciation fallback, often WAV from Wikimedia. |
| `googleTtsFallback` | audio | Always useful fallback, synthetic, should rank below native audio. |
| `youglish` | videoLinks | URL-only, reliable. |
| `bingImages`, `openverse`, `wikimediaCommons`, `duckduckgoImages` | imageUrl | Useful for image field but can be semantically noisy. For `picture` model field we keep frame capture, not these. |

### Standard quality conclusion

Standard online sources are strong for monolingual enrichment, audio fallback, examples, synonyms, antonyms, etymology and video links. They generally do **not** provide reliable Spanish lexical translations. Therefore Standard mode must keep the existing local/MT fallback for `bilingual`, while online sources improve all other rich-card fields.

## VIP source behavior

| Source | Fields observed | Quality notes |
|---|---|---|
| `cambridge` | phonetic, definitions, translations, examples | High-quality bilingual candidates but mixes lexical glosses with translated example sentences. Requires lexical cleaner. |
| `oxfordLearners` | phonetic, audio, definitions, examples, collocations | Excellent learner definitions/audio. Definitions are often better for cards than Free Dictionary. |
| `longman` | phonetic, audio, definitions, examples, collocations | Very good learner definitions and common usage. Strong candidate for primary `monolingual`. |
| `collins` | sometimes empty depending word/page | Keep as VIP source but expect empty responses on some words. |
| `merriamWebster` | sometimes empty depending word/page | Better for definitions/etymology where scraper succeeds. |
| `ozdic` | definitions, examples, collocations | Collocations source, but output can repeat generic definitions. Needs cleanup. |
| `reverso` | often empty in probe | Potentially useful for contextual examples/translations when it returns. Keep isolated. |
| `linguee` | translations | Useful but can return source-language echo (`give`) or phrase fragments. Needs lexical cleaner. |
| `wordReference` | translations, examples | Strong Spanish lexical source, but includes grammar labels (`⇒ vtr`, `loc nom f`) that must be stripped. |
| `spanishDict` | translations | Strong Spanish source, but can include phrase examples (`dame un beso`, `que tengas...`). Needs lexical cleaner. |
| `forvo` | sometimes empty | Native audio where available. Should rank above TTS. |

### VIP quality conclusion

VIP online sources are the right quality layer for `bilingual`, learner `monolingual`, IPA and word audio. However, raw `translations` from VIP sources are not guaranteed to be pure lexical glosses. They must be cleaned and ranked before entering the card's main `bilingual` field.

## Concrete raw findings

### `give`

Standard online returned no Spanish translation, but did return definitions/audio/examples. Free Dictionary chose the noun sense first: `The amount of bending...`, which is wrong for the sentence.

VIP online returned strong candidates:

- Cambridge: `dar`, `conceder algo`, but also translated example sentences.
- WordReference: `pasar ⇒ vtr`, `dar ⇒ vtr`, `alcanzar ⇒ vtr`, etc.
- SpanishDict: phrase-heavy candidates like `dame un beso`.

After cleaning, the card candidate became:

```text
dar · conceder algo · dar todo de sí · darlo todo
```

This is safe but still not perfect. For the sentence `wants to give me`, contextual ranking should prefer `dar` first and probably suppress idiomatic `dar todo de sí` unless the phrase matches.

### `wonderful`

Standard online returned definitions/audio/synonyms but no Spanish lexical translation.

VIP online returned:

```text
maravilloso
maravilloso/osa
maravilloso/a
algo maravilloso
```

This is good. The previous bad card value `maravilla` came from insufficient filtering/ranking, not from lack of good VIP data.

### `anything` / `anybody`

VIP online returned valid candidates plus context-sensitive opposites:

```text
anything: algo · nada · algo más · más que nada
anybody: alguien · nadie · ninguno/a · alguien más
```

For the positive question `Does anybody want anything else?`, the context should rank:

```text
anybody -> alguien
anything -> algo
```

A future contextual ranker should demote `nadie` in non-negative questions.

### `week`

VIP online returned good candidates:

```text
semana · cada semana · en una semana · semana calendario
```

The primary value should be `semana`. Other phrases are acceptable secondary glosses but should not crowd the main card.

### `know`

VIP online returned:

```text
saber · conocer · estar al corriente · saber de
```

This is good. Context can later choose `saber` for `I don't know` and `conocer` for `I know your mother`.

## Merge rules established by audit

1. Keep local/bundled/Yomitan for first paint and offline mode.
2. Do not trust bundle as premium-quality bilingual source.
3. Standard online should not be expected to fill Spanish `bilingual` reliably.
4. VIP translations must pass lexical cleaning before entering `entry.translation` / `entry.bilingual`.
5. Example translations must stay in `examples`, never in `bilingual`.
6. Learner dictionaries (`longman`, `cambridge`, `oxfordLearners`) should outrank Free Dictionary for primary `monolingual` when available.
7. Datamuse and similar n-gram collocations require stricter filters before display/save.
8. Word audio should rank native dictionary/audio sources above Google TTS.

## Current implemented fix

`src/background/enrichment/orchestrator.ts` now cleans and ranks source-attributed translations after all partials are collected. It strips grammar labels, rejects example sentences and avoids source-language echoes.

## Remaining work

1. Add a contextual lexical ranker for ambiguous candidates:
   - demote `nadie` unless sentence is negative/question polarity appropriate,
   - prefer `dar` for `give me`,
   - prefer `saber` for `I don't know`, `conocer` for people.
2. Filter noisy collocations from Datamuse/n-gram sources:
   - reject `word + determiner/modal/pronoun` patterns (`week a`, `give will`, `wonderful the`),
   - prefer source collocations from Oxford/Ozdic/Longman when VIP is enabled.
3. Add source-level regression snapshots for a stable small matrix, but keep network probes out of normal CI.
