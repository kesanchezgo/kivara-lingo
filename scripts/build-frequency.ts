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
 * Hygiene rules (issue #39). The raw list carries corpus noise that a
 * vocabulary model should never see, so three classes are dropped before
 * lemmatisation:
 *
 *   1. Single letters. The 26 alphabet tokens (`i`, `a`, `l`, `s`...) are
 *      either articles already covered by real lemmas or stray characters.
 *   2. Apostrophe fragments. The corpus tokenizer splits contractions at the
 *      apostrophe, so only fragments survive (`don` from don't, `didn` from
 *      didn't, `brien` from O'Brien). Only plain ASCII words are read, and the
 *      fragment stems in `CONTRACTION_STEMS` are removed explicitly.
 *   3. Proper names. The upstream list is fully lowercased (the FrequencyWords
 *      pipeline folds case before ranking; `en_50k.txt` has zero uppercase
 *      bytes), so there is no capitalization signal to read. The rule shipped
 *      here is the defensible substitute: an embedded inventory of given names,
 *      surnames, countries and major cities. Names that are also ordinary
 *      English words (`mark`, `will`, `rose`, `knight`, `turkey`, `iris`...)
 *      are deliberately kept, because dropping them would erase real
 *      vocabulary; the inventory was filtered against the bundled WordNet
 *      lexicon (src/assets/wordnet) to enforce that. Place names that WordNet
 *      stores as ordinary nouns are re-added explicitly, since they are proper
 *      by definition. To extend the list, append words to the `PROPER_NAMES`
 *      block and re-run the build.
 *
 * The output stays a pure function of the source plus these rule inputs, so a
 * re-run over the same `--input` reproduces the same lemma set.
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

/** Stems the tokenizer leaves behind when it splits a negative contraction at
 *  the apostrophe (`don't` → `don` + `t`). `won`, `can` and `haven` are
 *  deliberately absent: they are real English words ("he won", "a can", "a
 *  safe haven"). */
export const CONTRACTION_STEMS = new Set([
  'ain', 'aren', 'couldn', 'didn', 'doesn', 'don', 'hadn', 'hasn',
  'isn', 'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren',
  'wouldn',
]);

/** Curated proper-name inventory: given names, surnames, countries and major
 *  cities. The source is lowercased, so capitalization cannot be read; this
 *  list is the rule input that replaces it. Ordinary English words that double
 *  as names (`mark`, `will`, `rose`, `may`, `knight`, `butler`, `turkey`,
 *  `iris`, `lily`...) are not here on purpose: they are real vocabulary. The
 *  list was screened against the bundled WordNet lexicon to keep that split.
 *  Extend it when `--report` surfaces a name that slipped through. */
export const PROPER_NAMES = new Set(
  `
  aaron abdul abe abel abigail abraham achmed adam adams adele adrian adriana africa agnes aileen
  aimee alabama alan alaska albania albert alex alexis alfred algeria ali alice alicia alison
  allen allison alma amanda amato america amsterdam amy anderson andrea andrew andrews andy angela
  angelo angola anita ann anne annie anthony antoinette antonio archie argentina ariana ariel
  arizona arkansas armenia armstrong arnold arthur ashley asia athens atlanta audrey austin
  australia austria ava baghdad bahamas baltimore bangkok barbara barcelona barnes barry beatrice
  becky beijing beirut belgium belinda bella bennett berlin bernadette bernard bethany betty
  beverly bianca boston boyd bradley brandon brazil brenda brendan brian brianna bridget brien
  britain brittany brooke brooklyn brooks bruce brussels bryan bryant budapest burns byers byrne
  cairo california calvin camila camille campbell carl carla carlos carmen carolyn carrie carroll
  casey catherine cathy cecilia celia charlene charles charlie cheryl chicago chloe chris
  christina christine christopher cindy claire clara clark clarke claudia clint cody coleman colin
  colombia colorado columbia congo connie connor copenhagen cora courtney cragen craig crawford
  cristina cuba cunningham curtis cynthia cyprus dallas dalton damascus dan dana danielle daniels
  danny darlene darren dave david davis dawson debbie deborah debra delia denise denmark dennis
  denver derek desmond detroit devin dewitt diana diane dixon dolores dominic donald donovan dora
  doris dorothy doug douglas doyle dubai dublin duncan dunn dustin dylan eddie edgar edinburgh
  edith edna eduardo edward edwin egypt eileen elaine eleanor elena eli elias elijah elizabeth
  ella ellen elliot elliott ellis ellison eloise elsa emil emilio emily emma england enrique eric
  erik erin ernest este esther ethan ethel ethiopia eugene europe eva evan evans evelyn farrell
  felix ferguson fernando finland fiona fitzgerald fletcher florence florida floyd flynn france
  frances francesca francis francisco frankfurt fred freddie frederick gabriela gail gallagher
  garcia gardner gary gavin genevieve george georgia gerald geraldine germany gibson gil gina
  gloria gomez gonzalez gordon greece greene greg gregory guatemala gwendolyn hague halsey hamburg
  hamilton hannah hansen hanson hara hargrove harold harriet harris harrison harvey havana hawaii
  hawkins hayes heidi helen helena henderson herbert herman hernandez hicks hines hobbs hodges
  hoffman holi holland hollywood holmes honduras hong hopkins houston howard howell hudson hugh
  hughes hugo hungary ian iceland ignacio india indiana indonesia iran iraq ireland irene irwin
  isabel isabella israel istanbul italy ivan jackie jackson jacobs jacqueline jakarta jake jamaica
  james jamie jane janet janice japan jason javier jeanette jeff jeffrey jenkins jenna jennifer
  jennings jensen jeremy jerome jerusalem jesse jessica jesus jill jim joan joanne jocelyn joe
  joel joey johnson johnston jon jones jordan jorge jos jose joseph josephine joshua joyce juan
  judith judy julia julie julio justin kahn kane kansas karl kate katherine kathleen kathryn kathy
  katie katrina kay kayla keisha keith keller kelly kendra kennedy kenneth kent kentucky kenya
  kerr kevin kim kimberly korea kristen kristin kurt kuwait kyle kyoto larry larson laura lauren
  laurie lawrence lawson leah leary lebanon lena leon leona leonard leroy leslie lewis liam libya
  lilian lillian linda lisa lisbon liz lloyd logan lois lola london lonnie lopez lori lorraine
  louis louise louisiana lowell lucas lucia lucille lucy luis luke lydia lynn mabel mackenzie
  madeline madison madrid maggie maia maine malaysia malley malta mandy manhattan manuel marcia
  marco marcus margaret marie marilyn mario marion marjorie marr martha marvin mary maryland
  massachusetts matthew matthews maureen maurice maxine mccarthy mcdonald mcgee mckenzie mclean
  mcmillan mcpherson meadows medea megan melanie melinda melissa melvin mercedes meredith mexico
  mia miami michael michelle michigan miguel milan mildred mills milton minnesota miranda
  mississippi missouri mitchell monaco mongolia monica montana montreal moore morales morocco
  morris morrison morton moscow munich murray nadia nancy naomi nash natalie natasha nathan
  nathaniel neal nebraska neil neill nepal netherlands nevada newman nicholas nichols nicolas
  nicole nie nigeria nina noah nolan nora norma normandy norton norway nui oakley ohio oklahoma
  olga oliver olivia olsen olson omar oneill ophelia oregon orlando ortega osborne oslo ottawa
  otto owen oxford pablo pakistan palestine palmer pam pamela panama paris parker parsons patel
  patricia patrick patterson paula payne pearson pedro peggy penelope penn pennsylvania percy
  perez perkins persia peru pete peters peterson phil philadelphia philip philippines phillip
  phillips phyllis pierre poland polly portugal powell prague pretoria priscilla quebec quinn
  rachel ralph ramirez ramon ramsey randall raul raymond rebecca reeves reggie regina reginald
  reid reilly renee reyes reynolds rhodes ricardo richard richards richardson ricky riley rita
  rivera robbins robert roberta roberto roberts robertson robinson rochelle rodgers rodney
  rodriguez roger rogers roland romania rome ronald ronnie roosevelt rosalie rosemarie ross rourke
  rowe roxanne roy ruben russell russia rwanda ryan sabrina sacramento salazar salvador samantha
  sammy samuel sanders sandoval sandra santana santiago sara sarah sasha saudi saunders scarlett
  schmidt schneider schultz schumann scotland scott sean seattle selena selma senegal seoul serbia
  sergio seth shaffer shane shanghai shannon sharon shaun shaw shawn shea sheila shelly shepard
  sherman shields shirley siberia sicily sid sidney simmons simon simpson sinclair singapore singh
  sloan slovakia slovenia snyder sofia somalia sonia sophia sophie spain spencer stacy stan
  stanley steele stella stephanie stephen stephens steve steven stevens stevenson stewart sudan
  susan sutton suzanne swanson sweden switzerland sydney sylvia syria taiwan tamara tanya tara
  taylor tennessee teresa tess texas thailand thelma theresa thomas thompson thornton tiffany tim
  tina tobias todd tokyo tomas tommy tomoko tony toole toronto tracy travis trevor tristan tunisia
  tyler tyrone ukraine uruguay utah valerie vance vanessa vaughn vega venezuela venice vera
  vermont vernon vicki victoria vietnam vincent virginia vivian wales wallace walsh walter walters
  wanda warsaw watkins watson wayne webb webster wells wendell wendy wesley westminster whitaker
  whitfield whitney wilkins william williams williamson willie willy wilson winston winters wolfe
  woodward xavier yates yemen york yugoslavia yvonne zach zachary zimbabwe zimmerman zoe
  `
    .split(/\s+/)
    .filter(Boolean),
);

/** Why a plain-ASCII surface form is dropped, or null when it is kept. */
export function dropReason(form: string): DropReason | null {
  if (form.length < 2) return 'singleLetter'; // `i`, `a`, `l`...
  if (CONTRACTION_STEMS.has(form)) return 'contractionStem';
  if (PROPER_NAMES.has(form)) return 'properName';
  return null;
}

/** True when a surface form must not enter the list (hygiene rules above). */
export function isDroppedSurface(form: string): boolean {
  return dropReason(form) !== null;
}

/** Why a token was left out of the lemma list. `nonWord` covers punctuation,
 *  digits and apostrophe fragments rejected by `WORD`. */
export type DropReason = 'singleLetter' | 'contractionStem' | 'properName' | 'nonWord';

export type DropCounts = Record<DropReason, number>;

interface Built {
  lemmas: Map<string, number>;
  /** Kept surface forms mapped to the lemma they fold into. */
  surfaces: Map<string, string>;
  /** Rank of every kept surface form (1 = most frequent). */
  surfaceRank: Map<string, number>;
  surfaceCount: number;
  lemmaCount: number;
  dropped: DropCounts;
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

/** Surface forms we keep: plain lowercase ASCII words only. The corpus
 *  tokenizer splits contractions at the apostrophe, so anything containing one
 *  is a fragment (`'s`, `d've`, `'clock`); the readable stems are handled by
 *  `CONTRACTION_STEMS`. Also rejects "mr.", "mm-hmm", "yöu", "e-mail", "i-i" —
 *  a lemma rank list has no use for punctuation fragments. */
const WORD = /^[a-z]+$/;

/** Parse "word count" lines into [surface, rank] with rank = 1-based position.
 *  The position counts every line of the corpus (dropped tokens included), so
 *  the rank stays the surface form's real place in the subtitle list. Drops are
 *  counted per source line so `_meta` can report how much noise was removed. */
function parseSurfaceRanks(text: string): { surfaceRank: Map<string, number>; dropped: DropCounts } {
  const surfaceRank = new Map<string, number>();
  const dropped: DropCounts = { singleLetter: 0, contractionStem: 0, properName: 0, nonWord: 0 };
  let position = 0;
  for (const line of text.split('\n')) {
    const tab = line.indexOf(' ');
    if (tab <= 0) continue;
    const word = line.slice(0, tab).trim().toLowerCase();
    if (!word) continue;
    position += 1;
    if (!WORD.test(word)) {
      dropped.nonWord += 1;
      continue;
    }
    const reason = dropReason(word);
    if (reason) {
      dropped[reason] += 1;
      continue;
    }
    if (!surfaceRank.has(word)) surfaceRank.set(word, position);
  }
  return { surfaceRank, dropped };
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
  const parsed = parseSurfaceRanks(text);
  const surfaceRank = takeTop(parsed.surfaceRank, top);
  const lemmas = new Map<string, number>();
  const surfaces = new Map<string, string>();
  for (const [form, rank] of surfaceRank) {
    const lemma = lemmaFor(form, surfaceRank);
    surfaces.set(form, lemma);
    const known = lemmas.get(lemma);
    if (known === undefined || rank < known) lemmas.set(lemma, rank);
  }
  return {
    lemmas,
    surfaces,
    surfaceRank,
    surfaceCount: surfaceRank.size,
    lemmaCount: lemmas.size,
    dropped: parsed.dropped,
  };
}

function report(built: Built): void {
  console.log(`surface forms kept: ${built.surfaceCount}`);
  console.log(`lemmas: ${built.lemmaCount}`);
  console.log(`dropped: ${JSON.stringify(built.dropped)}`);
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
  const droppedTotal = Object.values(built.dropped).reduce((sum, n) => sum + n, 0);
  const meta = JSON.stringify({
    source: 'OpenSubtitles FrequencyWords (HermitDave)',
    license: SOURCE_LICENSE,
    builtAt,
    count: built.lemmaCount,
    surfaces: built.surfaceCount,
    dropped: { ...built.dropped, total: droppedTotal },
    shape: 'flat map lemma -> rank (1-based position of its most frequent surface form in the source list); count/surfaces describe the written cut, dropped covers the full source list; _meta is the only non-lemma key',
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

/** Import-safe: a test can pull the rule helpers without triggering a build. */
const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) void main();
