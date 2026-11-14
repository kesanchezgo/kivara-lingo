/**
 * Point 7 — clean what a source publishes before it reaches a card.
 *
 * The QA captured «greece_prefectures. kgm» and «VeoVeo—veo» as definitions.
 * Those are a source's machine keys: underscores instead of spaces, a trailing
 * abbreviation, and the lemma echoed under a card that already prints it.
 *
 * The rules stay conservative. They only touch shapes that cannot be a real
 * definition: a key with underscores, a bare lemma echo, blank placeholders
 * and a trailing one-to-three-letter abbreviation. Prose survives untouched.
 */

const BLANK_TOKEN = /^[_\s]+$/;
const ONLY_PUNCT = /^[\p{P}\p{S}\s]+$/u;
/** A trailing fragment like ". kgm" / ". m": abbreviation, not a sentence. */
const TRAILING_ABBREV = /\.\s+\p{L}{1,3}\s*$/u;

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function normalizeDefinition(text: string, lemma?: string): string {
  if (!text) return '';
  // Machine keys: `greece_prefectures` → `greece prefectures`.
  let out = text.replace(/_/g, ' ').replace(/[{}[\]]/g, ' ');
  out = squash(out);
  if (!out || ONLY_PUNCT.test(out)) return '';

  // A definition that is only the lemma (case/punct aside) says nothing.
  const bare = out.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').toLowerCase();
  const lemmaKey = (lemma ?? '').trim().toLowerCase();
  if (lemmaKey && bare === lemmaKey) return '';

  // Blank placeholders plus whatever survived next to them.
  out = out
    .split(' ')
    .filter((token) => !BLANK_TOKEN.test(token))
    .join(' ');
  out = squash(out);
  if (!out || ONLY_PUNCT.test(out)) return '';

  // The lemma echoed in front of the real text: `veo — veo the act of seeing`.
  if (lemmaKey) {
    const escaped = lemmaKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const echo = new RegExp(`^${escaped}\\s*[—–\\-:=]\\s*`, 'iu');
    if (echo.test(out)) out = squash(out.replace(echo, ''));
  }
  // ...or without a separator, `Larisa Larisa`.
  if (lemmaKey) {
    const words = out.split(' ');
    while (words.length > 1 && words[0].toLowerCase().replace(/[^\p{L}]/gu, '') === lemmaKey) {
      words.shift();
    }
    out = squash(words.join(' '));
  }
  if (!out || ONLY_PUNCT.test(out)) return '';

  // Trailing abbreviation noise. Only when something real precedes it.
  const trimmed = out.replace(TRAILING_ABBREV, '');
  if (trimmed && squash(trimmed).length >= 3) out = squash(trimmed);

  // Removing the echo can leave exactly the lemma: that is not a definition.
  const finalBare = out.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').toLowerCase();
  if (lemmaKey && finalBare === lemmaKey) return '';
  // A single very short fragment left over from a key is not a definition.
  if (out.length <= 3 && !/\s/.test(out)) return '';
  return out;
}
