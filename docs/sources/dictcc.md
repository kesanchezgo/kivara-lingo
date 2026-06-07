# dict.cc Source Notes

Tier target: VIP candidate / secondary bilingual source.

## Status

Raw audit: passed from Node with browser-like headers.
Parser snapshot: generated for `give`, `wonderful`, `anything`, `anybody`, `week`, `know`, `run`, `break up`, and `piece of cake` under `docs/reports/parser-snapshots/2026-06-07/dictcc/`.
Integration: integrated as VIP source `dictCc` on 2026-06-07. It runs only when VIP is enabled and the source toggle is on, with lower translation priority than PONS/bab.la/Cambridge/SpanishDict/WordReference.

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


## Integrated parser behavior

The runtime parser reads dict.cc's compact JavaScript arrays:

- `c1Arr`: Spanish side.
- `c2Arr`: English side.

It extracts:

- compact exact-match bilingual rows into `translations`,
- longer English rows containing the token into `collocations`.

Safety rules:

- examples and long rows never enter `bilingual`,
- domain/phrase rows are mostly treated as collocations,
- known literal false positives such as `tartaleta` for `piece of cake` are rejected,
- dict.cc is secondary and should not outrank PONS/bab.la/Cambridge/SpanishDict/WordReference.

Validated spot outputs:

```text
give -> dar, conceder
wonderful -> admirable, maravilloso
know -> saber
break up -> acabar
piece of cake -> no safe bilingual emitted
```

Quality note: dict.cc is useful as a compact fallback and phrase table, but it is not the primary VIP dictionary. Contextual ranking should prefer better sources when available.


## Integrated parser behavior

The runtime parser uses the compact `c1Arr` / `c2Arr` JavaScript arrays present in dict.cc HTML:

- `c1Arr` = Spanish side.
- `c2Arr` = English side.

It extracts:

- exact/compact bilingual matches into `translations`,
- longer English rows containing the token into `collocations`.

Safety rules:

- dict.cc is secondary and lower priority than PONS, bab.la, Cambridge, SpanishDict and WordReference.
- Example-like and phrase-specific rows do not become the main gloss.
- Known literal false positives for idioms are rejected.
- Long rows and bracketed/domain-only rows are treated as collocation candidates or ignored.

Validated spot outputs:

```text
give -> dar, conceder
wonderful -> admirable, maravilloso
know -> saber
break up -> acabar
piece of cake -> no safe bilingual emitted
```

Quality note: dict.cc is useful as fallback bilingual/phrase coverage. It should never be the top source when PONS/bab.la/Cambridge/SpanishDict/WordReference provide clean candidates.
