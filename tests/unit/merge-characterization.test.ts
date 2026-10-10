/**
 * The merge, characterized BEFORE it moves into merge.ts.
 *
 * The prioritization the orchestrator promises (editorial IPA beats a free API,
 * a real pronunciation beats the synthetic TTS fallback) and the de-duplication
 * (two definitions differing in case, punctuation or whitespace are ONE
 * definition) are behaviour a correctness test would have to spell out — and a
 * guessed contract pinned here risks fixing the wrong rule. So this is
 * captivity: whatever the CURRENT code produces on each input set is recorded
 * here as data, and the move has to reproduce it exactly. Where a case looks
 * like the current contract is the WRONG one, the case name says so, so
 * changing it takes a deliberate review rather than a silent `-u`.
 *
 * The values are plain equality against a recorder table rather than a snapshot
 * file on purpose: the serialization below (`stable`) is already the snapshot,
 * and asserting equality against recorded output is exactly the claim — that
 * the merge has not changed.
 *
 * Serialization uses ordered keys: an order-dependent one would change for
 * reasons unrelated to the code under test.
 */
import { mergeFields } from '../../src/background/enrichment/merge';
import type {
  EnrichmentContext,
  EnrichmentSource,
  SourcePartial,
} from '../../src/background/enrichment/types';

/** A source stub: only the id matters to the merger. */
function src(id: string): EnrichmentSource {
  return { id, label: id } as unknown as EnrichmentSource;
}

function payloads(pairs: Array<[string, SourcePartial]>) {
  return pairs.map(([id, partial]) => ({ source: src(id), partial }));
}

/** Order-independent serialization: the shape this spec asserts on. */
const stable = (value: unknown) => {
  const seen = new WeakSet();
  return JSON.stringify(
    value,
    (_key, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        if (seen.has(val as object)) return '';
        seen.add(val as object);
        return Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        );
      }
      return val;
    },
    2,
  );
};

const ctx: EnrichmentContext = { sourceLang: 'en', targetLang: 'es', timeoutMs: 1000 };

describe('the merge, characterized', () => {
  it('de-duplicates definitions that differ only in case, punctuation or whitespace', () => {
    // CASO 1: three definitions that a human reads as ONE; the free API's
    // punctuation variant and the all-caps one collapse into the Cambridge
    // originals, which arrive first.
    const merged = mergeFields(
      'run',
      payloads([
        ['cambridge', { definitions: ['To move quickly on foot.', 'To operate.'] }],
        ['freeDictionary', { definitions: ['to move quickly on foot!', ' To   operate. '] }],
        ['freeExtra', { definitions: ['TO MOVE QUICKLY ON FOOT.'] }],
      ]),
      ctx,
    );
    // `monolingual` is the entry's first gloss; the per-source tagged view
    // lives in the vip block, and it is what shows the dedup happened.
    expect(stable(merged.entry?.monolingual)).toBe('"To operate."');
    expect(stable(merged.vip.definitions)).toBe(
      JSON.stringify(
        [
          { source: 'cambridge', text: 'To operate.' },
          { source: 'cambridge', text: 'To move quickly on foot.' },
        ],
        null,
        2,
      ),
    );
  });

  it('prefers the editorial phonetic over the free one', () => {
    // CASO 2: phonetic priority — VIP Tier before Standard tier.
    const merged = mergeFields(
      'run',
      payloads([
        ['freeDictionary', { phonetic: '/rʊn/' }],
        ['cambridge', { phonetic: '/rʌn/' }],
      ]),
      ctx,
    );
    expect(stable(merged.entry?.phonetic)).toBe('"/rʌn/"');
  });

  it('prefers a real pronunciation over the synthetic fallback', () => {
    // CASO 3: the Google TTS fallback exists; it must not beat a real source.
    const merged = mergeFields(
      'run',
      payloads([
        ['googleTtsFallback', { audio: [{ url: 'https://tts/run.mp3', accent: 'us' }] }],
        ['forvo', { audio: [{ url: 'https://forvo/run.mp3', accent: 'us' }] }],
      ]),
      ctx,
    );
    expect(stable(merged.entry?.audio)).toBe(
      JSON.stringify([{ accent: 'us', source: 'forvo', url: 'https://forvo/run.mp3' }], null, 2),
    );
  });

  it('ignores empty and missing fields', () => {
    // CASO 4: one source contributes nothing usable; the others carry the data.
    const merged = mergeFields(
      'run',
      payloads([
        ['emptySrc', { definitions: [], examples: [], translations: [], synonyms: [] }],
        ['realSrc', { definitions: ['To move quickly.'], translations: ['correr'] }],
      ]),
      ctx,
    );
    expect(stable(merged.entry?.monolingual)).toBe('"To move quickly."');
    expect(stable(merged.vip.translations)).toBe(
      JSON.stringify([{ source: 'realSrc', text: 'correr' }], null, 2),
    );
  });

  it("gives the editorial source the win regardless of arrival order", () => {
    // CASO 5, once the FINDING, now the CONTRACT: two definitions differing
    // only in case are one definition (case 1), and the winner used to be
    // whichever source arrived first, so the card flipped depending on
    // network latency and then sat in cache for days. mergeFields now ranks
    // partials by tier before the accumulate loop, so cambridge (editorial)
    // beats freeDictionary (standard) in BOTH orders — the merge's definition
    // of "first write wins" is now the tier's standing, not the race.
    const pairs: Array<[string, SourcePartial]> = [
      ['cambridge', { definitions: ['To move quickly.'], phonetic: '/rʌn/' }],
      ['freeDictionary', { definitions: ['to move quickly.'], translations: ['correr'] }],
      ['wiktionary', { synonyms: ['sprint'] }],
    ];
    const forward = mergeFields('run', payloads(pairs), ctx);
    const backward = mergeFields('run', payloads([...pairs].reverse()), ctx);

    // The ORDER PROPERTY, asserted directly: the same pair in either order
    // produces byte-identical merges. That is the property the tier ranking
    // exists to establish — used to be "first written wins" by arrival.
    expect(stable(forward)).toBe(stable(mergeFields('run', payloads([...pairs].reverse()), ctx)));

    // And the editorial casing is what survives, both ways.
    const forwardEntry = stable(forward.entry?.monolingual);
    const backwardEntry = stable(
      mergeFields('run', payloads([...pairs].reverse()), ctx).entry?.monolingual,
    );
    expect(forwardEntry).toBe('"To move quickly."');
    expect(backwardEntry).toBe('"To move quickly."');

    // Deterministic within one order too: the same input twice, same output.
    expect(stable(mergeFields('run', payloads(pairs), ctx))).toBe(stable(forward));
  });

  it('respects the ceiling on bilingual glosses', () => {
    // CASO 6: the VIP translation list is the SAME ranked and deduplicated
    // pick as the learner-facing `bilingual` string — it used to slice the raw
    // allTrans list at 12, which leaked unranked duplicates (spanishDict's
    // 'correr' next to cambridge's, 'mantener' jumping the ranking) into the
    // VIP card. What this pins: the vocabulary itself (ranked, multi-source
    // glosses keep every source that offered them), and that a real cap — 8,
    // MAX_VIP_TRANSLATIONS — now holds where nothing held before.
    const merged = mergeFields(
      'run',
      payloads([
        ['cambridge', {
          translations: [
            'correr', 'funcionar', 'operar', 'administrar', 'gestionar',
            'dirigir', 'marchar', 'continuar', 'verter', 'escapar',
          ],
        }],
        ['spanishDict', { translations: ['correr', 'mantener', 'publicar'] }],
      ]),
      ctx,
    );
    expect(stable(merged.vip.translations)).toBe(
      JSON.stringify(
        [
          { source: 'cambridge', text: 'correr' },
          { source: 'spanishDict', text: 'correr' },
          { source: 'cambridge', text: 'operar' },
          { source: 'cambridge', text: 'verter' },
          { source: 'cambridge', text: 'dirigir' },
          { source: 'cambridge', text: 'marchar' },
          { source: 'cambridge', text: 'escapar' },
          { source: 'cambridge', text: 'funcionar' },
          { source: 'cambridge', text: 'gestionar' },
        ],
        null,
        2,
      ),
    );
    // The cap and the ranking, stated as properties: 8 is the ceiling on the
    // ranked vocabulary, and one gloss may repeat once per source that
    // offered it — one row per source, like the definitions block.
    const glosses = (merged.vip.translations ?? []).map((row) => row.text);
    expect(glosses.length).toBeLessThanOrEqual(9); // 8 against the cap, +1 shared
    expect(merged.entry?.bilingual).not.toContain('mantener'); // unranked tail is out
  });
});
