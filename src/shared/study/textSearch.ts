/** Ported from the v2 prototype (docs/REDESIGN-V2.md §5.3); behaviour unchanged. */

/**
 * Search across the transcript: case- and accent-insensitive («vuelos» finds
 * «Vuelos», «renuncia» finds «renunciá»). The folding is per character and
 * preserves length, so a match's indices apply as-is over the original text
 * (to highlight it).
 */
export type TextRange = [start: number, end: number];

export function foldForSearch(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const f = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    out += f ? f[0] : ch;
  }
  return out;
}

/** Matches of `foldedQuery` (already folded) in `text`, in order and non-overlapping. */
export function findRanges(text: string, foldedQuery: string): TextRange[] {
  if (!foldedQuery) return [];
  const hay = foldForSearch(text);
  const out: TextRange[] = [];
  for (let i = hay.indexOf(foldedQuery); i >= 0; i = hay.indexOf(foldedQuery, i + foldedQuery.length)) {
    out.push([i, i + foldedQuery.length]);
  }
  return out;
}

/** Chunks of a fragment that starts at `start` of the text: with a match or without it. */
export function splitByRanges(text: string, start: number, ranges: TextRange[]): { text: string; hit: boolean }[] {
  const end = start + text.length;
  const parts: { text: string; hit: boolean }[] = [];
  let pos = start;
  for (const [a, b] of ranges) {
    if (b <= pos || a >= end) continue;
    const s = Math.max(a, pos);
    if (s > pos) parts.push({ text: text.slice(pos - start, s - start), hit: false });
    const e = Math.min(b, end);
    parts.push({ text: text.slice(s - start, e - start), hit: true });
    pos = e;
  }
  if (pos < end) parts.push({ text: text.slice(pos - start), hit: false });
  return parts;
}
