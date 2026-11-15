/**
 * Saving a word while two cues overlap.
 *
 * #124 made the adapter emit the overlap as ONE cue whose id lists both spans
 * (`netflix-2000-4000|3300-6000`). `buildCueRequestFields` still looked the id
 * up with `findIndex(cue.id === activeCue.id)`, so it found nothing and the
 * card went out with no `contextLines` — the regression QA caught by calling
 * the real function.
 *
 * The line that holds the word is what the card should carry: the overlay
 * knows which member line was clicked, so the builder takes its index. A
 * selection or the whole line saves the SET (both member lines), with the
 * neighbours outside the set as context.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCueRequestFields,
  cueLineSpans,
  lineIndexOfOffset,
} from '../../src/content/ui/save-request';

/** The episode track around the overlap: A 2–4 s and B 3.3–6 s. */
const CUES = [
  { id: 'netflix-0-2000', start: 0, end: 2000, text: 'BEFORE THE OVERLAP' },
  { id: 'netflix-2000-4000', start: 2000, end: 4000, text: 'FIRST LINE' },
  { id: 'netflix-3300-6000', start: 3300, end: 6000, text: 'SECOND LINE' },
  { id: 'netflix-6000-8000', start: 6000, end: 8000, text: 'AFTER THE OVERLAP' },
];

const OVERLAP = { id: 'netflix-2000-4000|3300-6000', start: 2000, end: 6000 };

describe('buildCueRequestFields with a combined (overlapping) cue', () => {
  it('finds the member lines instead of failing on the composite id', () => {
    const fields = buildCueRequestFields(OVERLAP, CUES);
    expect(fields.contextLines).toEqual({
      prev: 'BEFORE THE OVERLAP',
      next: 'AFTER THE OVERLAP',
    });
    expect(fields.cueStart).toBe(2000);
    expect(fields.cueEnd).toBe(6000);
  });

  it('saves the LINE that holds the word, with that line\'s own cues', () => {
    const fields = buildCueRequestFields(OVERLAP, CUES, { lineIndex: 1 });
    expect(fields.sentence).toBe('SECOND LINE');
    expect(fields.cueStart).toBe(3300);
    expect(fields.cueEnd).toBe(6000);
    expect(fields.contextLines).toEqual({ prev: 'FIRST LINE', next: 'AFTER THE OVERLAP' });
  });

  it('saves the whole SET (selection / whole phrase) with outer context', () => {
    const fields = buildCueRequestFields(OVERLAP, CUES, { whole: true });
    expect(fields.sentence).toBe('FIRST LINE\nSECOND LINE');
    expect(fields.cueStart).toBe(2000);
    expect(fields.cueEnd).toBe(6000);
    expect(fields.contextLines).toEqual({
      prev: 'BEFORE THE OVERLAP',
      next: 'AFTER THE OVERLAP',
    });
  });

  it('resolves the members by time when the id carries no spans', () => {
    // Past the first line's end (4.0 s): only the second line overlaps.
    const fields = buildCueRequestFields({ id: 'netflix-live', start: 4100, end: 4200 }, CUES);
    expect(fields.cueStart).toBe(3300);
    expect(fields.cueEnd).toBe(6000);
    expect(fields.contextLines).toEqual({ prev: 'FIRST LINE', next: 'AFTER THE OVERLAP' });
  });

  it('leaves a single-cue save exactly as it was', () => {
    const fields = buildCueRequestFields({ id: 'netflix-2000-4000', start: 2000, end: 4000 }, CUES);
    expect(fields).toEqual({
      cueStart: 2000,
      cueEnd: 4000,
      contextLines: { prev: 'BEFORE THE OVERLAP', next: 'SECOND LINE' },
    });
  });
});

describe('cueLineSpans — which line of a combined plate a token sits in', () => {
  const text = 'FIRST LINE\nSECOND LINE';

  it('splits the plate into ordered spans', () => {
    expect(cueLineSpans(text)).toEqual([
      { start: 0, end: 10, text: 'FIRST LINE' },
      { start: 11, end: 22, text: 'SECOND LINE' },
    ]);
  });

  it('maps a token offset to its line', () => {
    const spans = cueLineSpans(text);
    expect(lineIndexOfOffset(spans, 2)).toBe(0); // "RST" of FIRST LINE
    expect(lineIndexOfOffset(spans, 12)).toBe(1); // "ECOND" of SECOND LINE
    expect(lineIndexOfOffset(spans, 999)).toBe(1); // past the end: last line
    expect(lineIndexOfOffset([], 4)).toBe(0);
  });

  it('handles a single line and the collapsed native-break mode', () => {
    expect(cueLineSpans('ONE LINE ONLY')).toEqual([
      { start: 0, end: 13, text: 'ONE LINE ONLY' },
    ]);
    // The plate collapses each line's inner whitespace; the spans follow.
    expect(cueLineSpans('A\r\nB   C\n\nD').map((span) => span.text)).toEqual(['A', 'B C', 'D']);
  });
});
