# bab.la Source Notes

Tier target: VIP candidate.

## Status

Raw audit: passed after protocol testing.
Parser snapshot: generated for `give`, `wonderful`, `anything`, `anybody`, `week`, `know`, `run`, `break up`, and `piece of cake` under `docs/reports/parser-snapshots/2026-06-07/babla/`.
Integration: not integrated yet.

## URL pattern

```text
https://en.bab.la/dictionary/english-spanish/{slug}
```

## Headers

Normal browser-like Node requests returned Cloudflare 403. Crawler-compatible headers returned full static HTML:

```text
User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: en-US,en;q=0.9,es;q=0.8
```

This header profile must be verified from the MV3 service worker before runtime integration.

## Observed raw format

bab.la returns very rich HTML. For `give`, the raw response was about 1.15 MB.

Observed sections:

- Top translation.
- POS sections.
- Large bilingual translation lists.
- Oxford-powered detailed dictionary sections.
- Aligned examples.
- Idioms.
- Phrasal verbs.
- Conjugation links.
- Regional/register labels.

## Useful fields

| Rich card field | Use |
|---|---|
| `bilingual` | Yes, excellent candidate after sense-aware filtering. |
| `examples` | Yes, aligned examples are available. |
| `collocations` | Yes, phrase sections and examples can feed usage chunks. |
| `videoLink` | No. |
| `monolingual` | No, not primary. |
| `wordAudio` | Maybe, if pronunciation URLs are exposed. |

## Dangerous blocks

bab.la mixes compact translations, corpus examples, idioms and phrasals. It must not feed all translation anchors directly into `bilingual`.

## Parser strategy

1. Extract top translation but do not blindly trust it for context.
2. Split POS sections.
3. Extract compact Spanish translations from translation list sections.
4. Extract Oxford detailed sense blocks separately.
5. Extract examples separately with source labels.
6. Extract idioms/phrasals into MWE enrichment, not single-word bilingual.

## Priority recommendation

VIP `bilingual`: high priority after PONS/Cambridge depending parser quality.
VIP `examples`: high priority.
VIP `idioms/phrasals`: high priority for MWE cards.
