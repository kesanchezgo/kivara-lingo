# WiktApi Source Notes

Tier target: Standard candidate.

## Status

Raw audit: passed from Node using documented API endpoints.
Parser snapshot: generated for `give`, `wonderful`, `anything`, `anybody`, `week`, `know`, and `run`; MWE endpoints returned 404 for `break up` and `piece of cake`, which means MWE handling should remain with idiom/phrasal sources rather than WiktApi single-word endpoints.
Integration: not integrated yet.

## URL patterns

```text
https://api.wiktapi.dev/v1/en/word/{word}?lang=en
https://api.wiktapi.dev/v1/en/word/{word}/translations?lang=en
https://api.wiktapi.dev/v1/en/word/{word}/pronunciations?lang=en
```

## Observed raw format

Structured JSON over Wiktionary/Kaikki data.

Observed endpoints returned 200 for `give`, `wonderful`, `anything`.

For `give`:

```text
full entry: ~79 KB
translations: ~51 KB
pronunciations: ~603 B
```

## Useful fields

| Rich card field | Use |
|---|---|
| `monolingual` | Yes. |
| `bilingual` | Yes, via translations endpoint. |
| `examples` | Yes, if present in senses. |
| `phonetic` | Yes. |
| `wordAudio` | Yes, if sounds include audio URLs. |
| `etymology` | Yes, if present. |
| `forms` | Useful for morphology/lemmatization, not direct Anki field. |

## Dangerous blocks

Wiktionary-derived data is broad. It can contain archaic, rare, regional or overly technical senses. It needs POS/context ranking.

## Parser strategy

1. Use JSON directly, no HTML parsing.
2. Filter entries by `lang_code: en`.
3. Group by POS.
4. Extract translations by target language `Spanish` / `es`.
5. Rank senses by context and frequency.
6. Use pronunciations endpoint for IPA/audio.

## Priority recommendation

Standard structured replacement/supplement for current Wiktionary REST/API/HTML sources. It should not block first paint; run in Standard online fan-out.
