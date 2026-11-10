/**
 * Build script: vocabulary test bank + pseudowords (phase F5, H8).
 *
 * Produces `src/assets/study/vocab-bank.json`:
 *
 *   words       4 frequency bands x 40 lemmas, sampled with a fixed seed from
 *               `src/assets/frequency/en-rank.json` (build-frequency.ts).
 *   pseudowords 60 pronounceable English-looking nonwords, stored literally
 *               (generated once, hand-checked) and validated here against the
 *               frequency list and the bundled dictionary so no real word ever
 *               reaches the yes/no test.
 *
 * The CEFR label is not invented here: it is the repo's own scale. `LABEL_RANK`
 * in src/shared/study/lexicalModel.ts gives the typical rank of a word labelled
 * at each level (A1 500, A2 1250, B1 2500, B2 3750, C1 5500, C2 8000), and the
 * label is the nearest of those on the logarithmic rank axis - the same
 * geometric-midpoint rule `levelForVocab()` uses for the inverse direction.
 *
 * Deterministic: the output depends only on en-rank.json and the seed; no
 * network, no clock.
 *
 * Usage:
 *   pnpm exec tsx scripts/build-vocab-bank.ts
 *   pnpm exec tsx scripts/build-vocab-bank.ts --dry
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LABEL_RANK, STUDY_LEVELS } from '../src/shared/study/lexicalModel';
import type { CefrLevel } from '../src/shared/study/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RANK_PATH = resolve(ROOT, 'src/assets/frequency/en-rank.json');
const DICT_PATH = resolve(ROOT, 'src/assets/dictionaries/en.json');
const OUT_PATH = resolve(ROOT, 'src/assets/study/vocab-bank.json');

const SEED = 0x5eedf5;
const PER_BAND = 40;
/** Rank windows, in the scale of en-rank.json. The two lower bands sit inside
 *  the A1-A2 range of LABEL_RANK, the third covers B1-B2, the fourth C1-C2. */
const BANDS = [
  { id: 'band1', from: 1, to: 1250 },
  { id: 'band2', from: 1251, to: 2500 },
  { id: 'band3', from: 2501, to: 5000 },
  { id: 'band4', from: 5001, to: 12000 },
] as const;

/**
 * Function words are excluded: a yes/no vocabulary test measures knowledge of
 * meaning-bearing words, and "the" or "of" are not informative. Only closed
 * classes and conversational fillers, no content words.
 */
const FUNCTION_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any',
  'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both',
  'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'during', 'each',
  'few', 'for', 'from', 'further', 'get', 'got', 'had', 'has', 'have', 'having', 'he', 'her',
  'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not',
  'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'whose',
  // conversational fillers of the subtitle corpus
  'uh', 'um', 'yeah', 'yep', 'nope', 'okay', 'ok', 'hey', 'hi', 'hello', 'bye', 'gonna',
  'wanna', 'gotta', 'kinda', 'sorta', 'dunno', 'huh', 'mmm', 'hmm', 'ah', 'oh', 'woah',
]);

/**
 * The subtitle list is lowercased and full of character names ("tom", "kate"),
 * interjections and swearing; a yes/no test cannot use any of them. The pool is
 * therefore restricted to headwords of the bundled dictionary (curated, 4.1k
 * entries, every band of the scale has hundreds) and this hand list drops the
 * few coarse words the dictionary does carry.
 */
const EXCLUDED = new Set([
  'shit', 'fuck', 'fucking', 'fucked', 'damn', 'damned', 'bitch', 'bastard', 'ass', 'asshole',
  'whore', 'slut', 'dick', 'cock', 'cunt', 'piss', 'pissed', 'nigger', 'fag', 'retard', 'screw',
  'porn', 'rape', 'raped', 'hell',
  // abbreviations, surname-likes and prefixes that slipped in as headwords
  'non', 'smith', 'mr', 'mrs', 'whose',
]);

/**
 * 60 pseudowords, generated once from a seeded syllable model and hand-checked
 * for pronounceability; unlisted here means the test has a real-word answer.
 */
const PSEUDOWORDS = [
  'flidar', 'sengock', 'snarplam', 'bromkir', 'brefliy', 'plezock', 'smerveth', 'plentock',
  'grisprosh', 'rindrom', 'femplon', 'thirmint', 'skempet', 'momtrom', 'proglost', 'bantrish',
  'zefick', 'prenkock', 'listoth', 'prilbrend', 'fazith', 'grisgot', 'glamthosh', 'flimsnith',
  'skamgent', 'konlock', 'zasdent', 'slosrost', 'scanvar', 'trannend', 'gramlont', 'grenflim',
  'plaskint', 'flaplang', 'zinthiy', 'misthash', 'kitrang', 'hemkang', 'flalges', 'theskof',
  'skamgring', 'trargel', 'cossmot', 'hicront', 'zidrast', 'skerstoy', 'priglosh', 'smoltith',
  'hemstil', 'selgrop', 'daglont', 'glihos', 'spobir', 'nirdas', 'scinbrep', 'nolsmont',
  'trimpef', 'drefang', 'framthock', 'golclad',
];

interface RankFile {
  _meta: { builtAt: string; license: string; count: number };
  [lemma: string]: unknown;
}

interface Word {
  word: string;
  rank: number;
  level: CefrLevel;
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest CEFR label on the logarithmic rank axis (the repo's LABEL_RANK scale). */
function levelOfRank(rank: number): CefrLevel {
  const x = Math.log(Math.max(1, rank));
  let best: CefrLevel = 'A1';
  for (const level of STUDY_LEVELS) {
    if (Math.abs(Math.log(LABEL_RANK[level]) - x) < Math.abs(Math.log(LABEL_RANK[best]) - x)) {
      best = level;
    }
  }
  return best;
}

/** In-place Fisher-Yates with a seeded generator. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function main(): void {
  const raw = JSON.parse(readFileSync(RANK_PATH, 'utf8')) as RankFile;
  const lemmas: Array<[string, number]> = [];
  for (const [word, rank] of Object.entries(raw)) {
    if (word === '_meta') continue;
    if (typeof rank === 'number') lemmas.push([word, rank]);
  }
  if (!lemmas.length) throw new Error('en-rank.json has no lemmas; run build-frequency.ts first');
  const dictAsset = JSON.parse(readFileSync(DICT_PATH, 'utf8')) as Record<string, unknown>;
  const dictWords = new Set(Object.keys(dictAsset));

  const words: Word[] = [];
  for (const [i, band] of BANDS.entries()) {
    const pool = lemmas
      .filter(([word, rank]) => {
        if (rank < band.from || rank > band.to) return false;
        if (!/^[a-z]{3,}$/.test(word)) return false; // no contractions, no 1-2 letter tokens
        if (!dictWords.has(word)) return false; // dictionary headword: real, curated, not a name
        return !FUNCTION_WORDS.has(word) && !EXCLUDED.has(word);
      })
      .sort((a, b) => a[1] - b[1]);
    if (pool.length < PER_BAND) {
      throw new Error(`${band.id}: only ${pool.length} candidates, need ${PER_BAND}`);
    }
    const rng = mulberry32(SEED + i * 7919);
    const picked = shuffle([...pool], rng).slice(0, PER_BAND).sort((a, b) => a[1] - b[1]);
    for (const [word, rank] of picked) words.push({ word, rank, level: levelOfRank(rank) });
  }

  // No real word may be inside the pseudoword set, and no duplicates inside it.
  const realWords = new Set(lemmas.map(([word]) => word));
  const seen = new Set<string>();
  for (const pw of PSEUDOWORDS) {
    if (seen.has(pw)) throw new Error(`duplicate pseudoword: ${pw}`);
    if (realWords.has(pw)) throw new Error(`pseudoword collides with a frequency lemma: ${pw}`);
    if (dictWords.has(pw)) throw new Error(`pseudoword collides with a dictionary entry: ${pw}`);
    if (!/^[a-z]{5,9}$/.test(pw)) throw new Error(`pseudoword not a plausible shape: ${pw}`);
    seen.add(pw);
  }
  if (PSEUDOWORDS.length !== 60) throw new Error(`expected 60 pseudowords, got ${PSEUDOWORDS.length}`);
  if (words.length !== BANDS.length * PER_BAND) {
    throw new Error(`expected ${BANDS.length * PER_BAND} words, got ${words.length}`);
  }

  const byLevel: Record<string, number> = {};
  for (const w of words) byLevel[w.level] = (byLevel[w.level] ?? 0) + 1;

  const out = {
    _meta: {
      dataset: 'Vocabulary test bank',
      source: 'Sampled from src/assets/frequency/en-rank.json (OpenSubtitles FrequencyWords, HermitDave)',
      license: 'CC BY-SA 4.0 (derived from the frequency list; ShareAlike travels with this file)',
      builtAt: raw._meta.builtAt,
      seed: SEED,
      bands: BANDS.map((b) => `${b.id}: rank ${b.from}-${b.to}`),
      count: words.length,
      pseudowordCount: PSEUDOWORDS.length,
    },
    words,
    pseudowords: [...PSEUDOWORDS],
  };

  console.log(`words: ${words.length} (4 bands x ${PER_BAND})`);
  console.log(`by level: ${STUDY_LEVELS.map((l) => `${l}=${byLevel[l] ?? 0}`).join(' ')}`);
  console.log(`pseudowords: ${PSEUDOWORDS.length}`);
  console.log(`bands: ${BANDS.map((b) => `${b.id} ${b.from}-${b.to}`).join(', ')}`);

  if (process.argv.includes('--dry')) {
    console.log('dry run: not written');
    return;
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`wrote ${OUT_PATH}`);
}

main();