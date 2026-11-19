/**
 * ONE plain-text normalizer for Anki field content, shared by every caller
 * that compares note text (identity compare, sentence dedup, gloss read,
 * saved-words fallback). Decodes the full entity set — named, decimal and
 * hex — so `She&#39;s` and `She's` compare equal everywhere.
 */
function codePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : ' ';
}

export function htmlToPlain(raw: string): string {
  return String(raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => codePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => codePoint(parseInt(h, 16)))
    .replace(/\[sound:[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
