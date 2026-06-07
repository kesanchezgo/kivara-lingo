# PONS Source Notes

Tier target: VIP candidate.

## Status

Raw audit: passed from Node with browser-like headers.
Parser snapshot: generated for `give`, `wonderful`, `anything`, `anybody`, `week`, `know`, `run`, `break up`, and `piece of cake` under `docs/reports/parser-snapshots/2026-06-07/pons/`.
Integration: integrated as VIP source `pons` on 2026-06-07. It runs only when VIP is enabled and the source toggle is on.

## URL pattern

```text
https://en.pons.com/translate/english-spanish/{slug}
```

## Headers

Browser-like HTML headers are sufficient in raw audit.

## Observed raw format

PONS returns large HTML pages. For `give`, the raw response was about 2.25 MB. The page includes Oxford Spanish Dictionary sections.

Observed sections and data types:

- Roman numeral / numbered sense groups.
- POS labels.
- IPA and audio icon hints.
- Single-word translations.
- Phrase-pattern translations, for example `give her/me/them a glass of water`.
- Aligned example translations.
- Regional labels such as Mexican Spanish / European Spanish.
- Register labels like formal / informal.

## Useful fields

| Rich card field | Use |
|---|---|
| `bilingual` | Yes, but only compact lexical entries from the relevant sense. |
| `examples` | Yes, aligned EN/ES examples are valuable. |
| `monolingual` | No, PONS is mainly bilingual for this use. |
| `phonetic` | Maybe, if audio/IPA is parseable. |
| `wordAudio` | Maybe, if audio URLs can be extracted reliably. |
| `collocations` | Yes, phrase patterns can feed collocation/usage chunks. |

## Dangerous blocks

Do not dump all Spanish links into `bilingual`. The raw page contains examples and phrase translations that are sentence-like. These belong to `examples` or phrase/usage fields.

## Parser strategy

1. Split by top dictionary entry and POS.
2. Preserve sense headings, for example `give (to hand)`.
3. Extract lexical translation rows as candidates.
4. Extract aligned examples separately.
5. Extract phrase-pattern rows separately for `collocations` / usage chunks.
6. Rank by context, prioritizing the sense matching the subtitle sentence.

## Priority recommendation

For VIP `bilingual`, PONS should rank very high, likely before or alongside Cambridge/bab.la, but only after parser snapshots validate extraction.


## Integrated parser behavior

The runtime parser uses `add-to-vocabulary-trainer` button metadata because it carries source text, target text and sense headers in stable data attributes.

It separates:

- compact lexical translations into `translations`,
- sentence-like aligned pairs into `examples`,
- short source phrase rows into `collocations`.

Safety rules:

- target sentences and conjugated phrases are rejected from `translations`,
- examples never enter `bilingual`,
- source rows for Spanish-to-English sections are ignored unless the English token appears in the source side,
- MWE coverage is partial; `piece of cake` snapshot showed mostly reverse-direction rows, so dedicated idiom sources still own that case.

Validated spot outputs:

```text
give -> dar, regalar, obsequiar, donar, prestar, entregar
wonderful -> maravilloso, maravilloso, -a, extraordinario
anything -> algo, nada, casi nada, cualquier cosa
know -> saber, conocer, ...
break up -> desguazar, dividir, descomponer, disolver, deshacer
```

PONS ranks first among VIP lexical candidates, but field-level ranking still dedupes and can be improved later with context/polarity scoring.
