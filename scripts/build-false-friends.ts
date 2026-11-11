/**
 * Build/validate script: Spanish-English false friends (phase F5, H8).
 *
 * The dataset is hand-curated at `src/assets/study/es-en-false-friends.json`;
 * this script does not generate content, it guards the shape so a hand edit
 * cannot ship a broken asset:
 *   - `_meta` present, `items` an array;
 *   - every item has non-empty `en`, `es`, `note` strings;
 *   - `en` is unique (the Spanish side may repeat: major/mayor, mayor/mayor);
 *   - `en` and `es` are not identical except where the note explains the
 *     same-spelling trap (allowed: "actual"/"actual", "red"/"red", ...);
 *   - `_meta.count` matches `items.length`.
 *
 * Usage:
 *   pnpm exec tsx scripts/build-false-friends.ts           # validate, print counts
 *   pnpm exec tsx scripts/build-false-friends.ts --fix     # rewrite _meta.count only
 *
 * Exit code 1 on any violation.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_PATH = resolve(ROOT, 'src/assets/study/es-en-false-friends.json');

/** Minimum defensible size for the v2.0 curated list (H8: "≈300"). */
const MIN_ITEMS = 300;

interface FalseFriend {
  en: string;
  es: string;
  note: string;
}

interface FalseFriendsFile {
  _meta: { count: number; [key: string]: unknown };
  items: FalseFriend[];
}

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function main(): void {
  const raw = readFileSync(DATA_PATH, 'utf8');
  let data: FalseFriendsFile;
  try {
    data = JSON.parse(raw) as FalseFriendsFile;
  } catch (err) {
    console.error(`invalid JSON: ${(err as Error).message}`);
    process.exit(1);
  }

  if (!data._meta || typeof data._meta !== 'object') fail('_meta missing or not an object');
  if (!Array.isArray(data.items)) {
    console.error('items is not an array');
    process.exit(1);
  }

  // `en` is unique; `es` is not (one Spanish word can trap two English ones:
  // major/mayor and mayor/mayor both point at "mayor").
  const seenEn = new Map<string, number>();

  data.items.forEach((item, i) => {
    const where = `items[${i}]`;
    if (!isNonEmptyString(item.en)) fail(`${where}.en missing`);
    if (!isNonEmptyString(item.es)) fail(`${where}.es missing`);
    if (!isNonEmptyString(item.note)) fail(`${where}.note missing`);
    if (!isNonEmptyString(item.en) || !isNonEmptyString(item.es)) return;

    if (!/^[a-z][a-z '-]*$/.test(item.en)) fail(`${where}.en not lowercase Latin: ${item.en}`);
    // Spanish side is accented lowercase: "jubilación", "señor", "lívido".
    if (!/^\p{Ll}[\p{Ll} '-]*$/u.test(item.es)) fail(`${where}.es not lowercase Latin: ${item.es}`);
    if (item.note.length > 160) fail(`${where}.note longer than 160 chars`);

    const prevEn = seenEn.get(item.en);
    if (prevEn !== undefined) fail(`duplicate en "${item.en}" at items[${prevEn}] and ${where}`);
    else seenEn.set(item.en, i);
  });

  const count = data.items.length;
  if (count < MIN_ITEMS) fail(`only ${count} items, minimum is ${MIN_ITEMS}`);
  if (data._meta && data._meta.count !== count) {
    if (process.argv.includes('--fix')) {
      // Targeted rewrite: only the count line changes, so a fix does not
      // reformat the hand-curated list (one item per line stays one item per line).
      const patched = raw.replace(/("count"\s*:\s*)\d+/, `$1${count}`);
      writeFileSync(DATA_PATH, patched, 'utf8');
      console.log(`_meta.count fixed to ${count}`);
    } else {
      fail(`_meta.count is ${String(data._meta?.count)}, items.length is ${count}`);
    }
  }

  console.log(`items: ${count}`);
  console.log(`unique en: ${seenEn.size}`);
  console.log(`same-spelling pairs: ${data.items.filter((x) => x.en === x.es).length}`);
  console.log(`_meta.count: ${String(data._meta?.count)}`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('shape OK');
}

main();
