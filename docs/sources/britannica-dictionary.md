# Britannica Dictionary Source Notes

Tier target: Standard candidate.

## Status

Raw audit: passed from Node with browser-like headers.
Parser snapshot: generated for `give`, `wonderful`, `anything`, `anybody`, `week`, `know`, `run`, `break up`, and `piece of cake` under `docs/reports/parser-snapshots/2026-06-07/britannicaDictionary/`.
Integration: not integrated yet.

## URL pattern

```text
https://www.britannica.com/dictionary/{word}
```

## Observed raw format

Britannica returns learner-dictionary HTML. For `give`, response was about 349 KB.

Observed sections:

- Entry list / related entries.
- Headword and IPA.
- POS sections.
- Numbered learner definitions.
- Many examples.
- Phrasal verbs.
- Idioms.

## Useful fields

| Rich card field | Use |
|---|---|
| `monolingual` | Yes, strong Standard candidate. |
| `examples` | Yes. |
| `phonetic` | Maybe. |
| `collocations` | Maybe from phrase/examples, not primary. |
| `bilingual` | No. |

## Dangerous blocks

The page has many related entries and idiom/phrasal sections. Parser must avoid choosing a related entry instead of the main entry unless the token is itself an MWE.

## Parser strategy

1. Locate main headword entry.
2. Extract POS.
3. Extract numbered definitions and examples.
4. For phrasal/idiom sections, route to MWE enrichment.
5. Use context/POS ranking to avoid wrong senses for polysemous words.

## Priority recommendation

Standard `monolingual`: should outrank FreeDictionary when parser finds a clear learner definition.
Standard `examples`: good secondary source.
