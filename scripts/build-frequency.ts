/**
 * Build script: English subtitle frequency list (lemma → rank).
 *
 * Phase F5 / H8 of docs/REDESIGN-V2.md. Produces
 * `src/assets/frequency/en-rank.json`, a compact object `{ "<lemma>": <rank> }`
 * with a `_meta` sibling. The rank is the 1-based position of the lemma's most
 * frequent surface form in the OpenSubtitles FrequencyWords list, so it doubles
 * as the study model's difficulty scale (see src/shared/study/lexicalModel.ts,
 * which reads a rank on that same axis).
 *
 * Source: OpenSubtitles FrequencyWords by HermitDave, CC BY-SA 4.0.
 *   https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
 * The build downloads it once into a temp cache (never into the bundle) and can
 * be pointed at a local copy with `--input` for a fully offline re-run.
 *
 * Lemmatization uses the repo's own `lemmaCandidates()` (src/content/nlp/lemma.ts)
 * as the candidate generator and two high-precision gates so a real word never
 * gets swallowed by an unrelated base form (the classic failure cases are
 * plural -s and -ing/-ed on monosyllables: "notes" vs "not", "seed" vs "see",
 * "his" vs "hi"):
 *   1. A candidate is only accepted if it is itself a surface form of the list
 *      (a fabricated stem like "noth" or "bett" never is).
 *   2. The base form must be at least as frequent as the surface form, but not
 *      more than `MERGE_RATIO` times more frequent. An inflection sits next to
 *      its lemma ("times" vs "time", ×6.7); a function word that merely shares
 *      a prefix ("not" vs "notes", ×40) is rejected and the next candidate wins.
 * Irregular forms (hand table in lemma.ts) are trusted unconditionally: they
 * are curated, and the ratio gate would otherwise drop valid pairs like
 * "people" → "person".
 *
 * Usage:
 *   pnpm exec tsx scripts/build-frequency.ts                 # top 30k forms (default)
 *   pnpm exec tsx scripts/build-frequency.ts --top 50000
 *   pnpm exec tsx scripts/build-frequency.ts --input ./en_50k.txt
 *   pnpm exec tsx scripts/build-frequency.ts --refresh       # ignore the temp cache
 *   pnpm exec tsx scripts/build-frequency.ts --built-at 2026-01-01T00:00:00Z
 *
 * Deterministic: same input → same bytes, except `_meta.builtAt`, which is the
 * only wall-clock field and can be pinned with `--built-at`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IRREGULAR_LEMMAS, lemmaCandidates } from '../src/content/nlp/lemma';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(ROOT, 'src/assets/frequency/en-rank.json');

const SOURCE_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt';
const SOURCE_LICENSE = 'CC BY-SA 4.0';
const CACHE_PATH = resolve(tmpdir(), 'kivara-lingo-freq-cache', 'en_50k.txt');

/** Default cut: the top 28 000 surface forms. 30 000 of them lemmatize to
 *  23 000 lemmas but the JSON lands at ~366 KB raw; at 28 000 it is 22 100
 *  lemmas in ~345 KB, inside the ~350 KB asset budget of H8. The dropped tail
 *  sits far above rank 9 000, the ceiling of the study model's difficulty
 *  scale, so nothing the estimator can reach is lost. */
const DEFAULT_TOP = 28000;
/** Refuse to write anything smaller: the study model tests ranks up to ~9k,
 *  so a truncated list would silently break the vocabulary estimate. */
const MIN_LEMMAS = 20000;
/** How many times more frequent a base may be than its surface form. */
const MERGE_RATIO = 10;
/** A surface form is only collapsed when it is not a real word on its own.
 *  These keep the high-frequency function words and the nouns the suffix rules
 *  over-reach on. Every entry comes from the `--report` output, never a guess. */
const NO_MERGE = new Set([
  // possessives / function words where the -s rule would eat the last letter
  'its', 'his', 'hers', 'theirs', 'ours', 'yours',
  'as', 'is', 'was', 'yes', 'this', 'thus', 'us', 'plus',
  // nouns whose stem is a different, more frequent word
  'news', 'evening', 'officer', 'career', 'shower', 'butter',
  'former', 'offer', 'stranger', 'flower', 'parker', 'mrs', 'bother',
]);

interface Built {
  lemmas: Map<string, number>;
  /** Kept surface forms mapped to the lemma they fold into. */
  surfaces: Map<string, string>;
  /** Rank of every kept surface form (1 = most frequent). */
  surfaceRank: Map<string, number>;
  surfaceCount: number;
  lemmaCount: number;
}

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const i = process.argv.indexOf(hit);
  return process.argv[i + 1];
}

function loadedPath(): string {
  const input = argValue('--input');
  if (input) return resolve(process.cwd(), input);
  if (!process.argv.includes('--refresh') && existsSync(CACHE_PATH)) return CACHE_PATH;
  return '';
}

async function load(sourcePath: string): Promise<string> {
  if (sourcePath) {
    console.log(`reading frequency list from ${sourcePath}`);
    return readFileSync(sourcePath, 'utf8');
  }
  console.log(`downloading ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, text, 'utf8');
  console.log(`cached at ${CACHE_PATH}`);
  return text;
}

/** Surface forms we keep: plain words and inner-apostrophe contractions.
 *  Rejects the corpus noise ("'s", "'t", "mr.", "mm-hmm", "yöu", "e-mail",
 *  "i-i") — a lemma rank list has no use for punctuation fragments. */
const WORD = /^[a-z]+(?:'[a-z]+)*$/;

/** Parse "word count" lines into [surface, rank] with rank = 1-based position.
 *  The position counts every line of the corpus (dropped tokens included), so
 *  the rank stays the surface form's real place in the subtitle list. */
function parseSurfaceRanks(text: string): Map<string, number> {
  const surfaceRank = new Map<string, number>();
  let position = 0;
  for (const line of text.split('\n')) {
    const tab = line.indexOf(' ');
    if (tab <= 0) continue;
    const word = line.slice(0, tab).trim().toLowerCase();
    if (!word) continue;
    position += 1;
    if (!WORD.test(word)) continue;
    if (!surfaceRank.has(word)) surfaceRank.set(word, position);
  }
  return surfaceRank;
}

/** Order surface forms by rank and cut to the top N. `surfaceRank` only holds
 *  the kept forms, so N is a count of real words, not of corpus lines. */
function takeTop(surfaceRank: Map<string, number>, top: number): Map<string, number> {
  const ordered = [...surfaceRank.entries()].sort((a, b) => a[1] - b[1]).slice(0, top);
  return new Map(ordered);
}

/**
 * Lemma for one surface form under the gates documented at the top.
 * Returns the surface form itself when nothing else is defensible.
 */
function lemmaFor(form: string, surfaceRank: Map<string, number>): string {
  const rank = surfaceRank.get(form)!;
  if (NO_MERGE.has(form)) return form;

  const irregular = IRREGULAR_LEMMAS[form];
  if (irregular && irregular !== form && surfaceRank.has(irregular)) return irregular;

  // The -ly derivation is the least reliable rule here (a learner's rank for
  // "hardly" is its own, not "hard"'s), so adverbs stay their own lemma.
  if (form.endsWith('ly') && form.length > 4) return form;

  for (const candidate of lemmaCandidates(form).slice(1)) {
    const baseRank = surfaceRank.get(candidate);
    if (baseRank === undefined) continue;
    if (baseRank > rank) continue; // the base must not be rarer than the surface
    if (rank > baseRank * MERGE_RATIO) continue; // …nor a distant function word
    return candidate;
  }
  return form;
}

function build(top: number, text: string): Built {
  const all = parseSurfaceRanks(text);
  const surfaceRank = takeTop(all, top);
  const lemmas = new Map<string, number>();
  const surfaces = new Map<string, string>();
  for (const [form, rank] of surfaceRank) {
    const lemma = lemmaFor(form, surfaceRank);
    surfaces.set(form, lemma);
    const known = lemmas.get(lemma);
    if (known === undefined || rank < known) lemmas.set(lemma, rank);
  }
  return { lemmas, surfaces, surfaceRank, surfaceCount: surfaceRank.size, lemmaCount: lemmas.size };
}

function report(built: Built): void {
  console.log(`surface forms kept: ${built.surfaceCount}`);
  console.log(`lemmas: ${built.lemmaCount}`);
  const top = [...built.lemmas.entries()].sort((a, b) => a[1] - b[1]).slice(0, 20);
  console.log(`first 20 lemmas: ${top.map(([w, r]) => `${w}:${r}`).join(' ')}`);
}

/** `--report`: list the merges that touch the very common band, so a later
 *  change in lemma.ts cannot silently fold two unrelated words together. */
function reportCommonMerges(built: Built, limit: number): void {
  const merged = [...built.surfaces]
    .filter(([form, lemma]) => form !== lemma && (built.surfaceRank.get(form) ?? 0) <= limit)
    .sort((a, b) => (built.surfaceRank.get(a[0]) ?? 0) - (built.surfaceRank.get(b[0]) ?? 0));
  console.log(`merged surface forms with rank ≤ ${limit}: ${merged.length}`);
  console.log(merged.map(([form, lemma]) => `${form}→${lemma}`).join(' '));
}

async function main(): Promise<void> {
  const top = Number(argValue('--top') ?? DEFAULT_TOP);
  if (!Number.isFinite(top) || top < MIN_LEMMAS) {
    throw new Error(`--top must be a number ≥ ${MIN_LEMMAS}`);
  }
  const builtAt = argValue('--built-at') ?? new Date().toISOString();

  const text = await load(loadedPath());
  const built = build(Math.floor(top), text);
  report(built);
  if (process.argv.some((a) => a === '--report' || a.startsWith('--report='))) {
    reportCommonMerges(built, Number(argValue('--report') ?? 200));
  }

  if (built.lemmaCount < MIN_LEMMAS) {
    throw new Error(`refusing to write: ${built.lemmaCount} lemmas < minimum ${MIN_LEMMAS}`);
  }

  const lemmas = [...built.lemmas.entries()].sort((a, b) => a[1] - b[1]);
  const meta = JSON.stringify({
    source: 'OpenSubtitles FrequencyWords (HermitDave)',
    license: SOURCE_LICENSE,
    builtAt,
    count: built.lemmaCount,
    shape: 'flat map lemma -> rank (1-based position of its most frequent surface form in the source list); _meta is the only non-lemma key',
  });
  // Emit lemma keys in rank order (visual diff stability), one per line so the
  // file stays greppable and re-runs produce byte-identical output.
  const rows = lemmas.map(([word, rank]) => `${JSON.stringify(word)}:${rank}`).join(',\n');
  const out = `{\n"_meta":${meta},\n${rows}\n}\n`;
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, out, 'utf8');

  const sha = createHash('sha256').update(out).digest('hex').slice(0, 12);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
  console.log(`wrote ${OUT_PATH} (${kb} KB, sha256:${sha})`);
}

void main();
