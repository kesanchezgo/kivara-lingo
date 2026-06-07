# Britannica Dictionary Source Notes

Tier target: Standard candidate.

## Status

Raw audit: passed from Node with browser-like headers.
Parser snapshot: generated for `give`, `wonderful`, `anything`, `anybody`, `week`, `know`, `run`, `break up`, and `piece of cake` under `docs/reports/parser-snapshots/2026-06-07/britannicaDictionary/`.
Integration: integrated as Standard source `britannicaDictionary` on 2026-06-07. It runs in the Standard fan-out and is individually togglable in the VIP/Standard settings UI.

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


## Integrated parser behavior

The runtime source extracts:

- `def_text` spans as learner definitions.
- `vi_content` divs as examples.
- `pron_w` spans as IPA.
- `play_pron` audio metadata as Merriam-Webster media MP3 URLs.

Context ranking is intentionally light and source-local. It fixes observed snapshot problems such as:

- `give` preferring gift/transfer definitions over noun flexibility.
- `week` preferring seven-day definitions.
- `know` preferring understand/aware/certain definitions.
- `run` preferring move/operate/manage definitions over unrelated adjective/noun senses.
- `anything` preferring thing-of-any-kind definitions.

Britannica does not feed `bilingual`; it improves Standard `monolingual`, examples, IPA and word audio.
