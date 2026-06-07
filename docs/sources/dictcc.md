# dict.cc Source Notes

Tier target: VIP candidate / secondary bilingual source.

## Status

Raw audit: passed from Node with browser-like headers.
Parser snapshot: generated for `give`, `wonderful`, `anything`, `anybody`, `week`, `know`, `run`, `break up`, and `piece of cake` under `docs/reports/parser-snapshots/2026-06-07/dictcc/`.
Integration: not integrated yet.

## URL pattern

```text
https://enes.dict.cc/?s={query}
```

## Observed raw format

HTML table for English-Spanish translations.

Observed sections:

- Word class rows.
- Translation tables.
- Subject/domain labels.
- Phrase rows.
- Idiom rows.
- Audio/info icons.

## Useful fields

| Rich card field | Use |
|---|---|
| `bilingual` | Yes, secondary source after parser cleanup. |
| `collocations` | Yes, phrase rows can feed usage chunks. |
| `examples` | Limited, mostly phrase translations rather than full examples. |
| `wordAudio` | Maybe, icons exist but URLs need deeper extraction. |

## Dangerous blocks

The table mixes single-word translations, phrases, idioms, domain rows and example-like rows. Parser must not dump all rows into `bilingual`.

## Parser strategy

1. Split table rows.
2. Identify exact headword rows vs phrase rows.
3. Preserve domain/register labels.
4. Route phrase rows to collocations/usage, not main bilingual unless the token is an MWE.
5. Deduplicate Spanish candidates.

## Priority recommendation

Use after PONS, bab.la, Cambridge, SpanishDict and WordReference for bilingual. Useful fallback and phrase support.
