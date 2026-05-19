/**
 * Build script: merge curated B1/B2/C1 entries from `data/cefr-b1-c1-en-es.json`
 * into the bundled offline dictionary at `src/assets/dictionaries/en.json`.
 *
 * Usage:
 *   pnpm dict:build         # writes the merged en.json in-place
 *   pnpm dict:build --dry   # prints stats but doesn't write
 *
 * Why a build script and not a runtime-merge in `dictionary.ts`? The runtime
 * path is loaded on every popover open — touching it adds startup latency
 * to every user. Doing the merge at build time keeps the runtime fast and
 * lets the curated data live in a hand-editable JSON file that's easy to
 * diff in PRs.
 *
 * The seed file is structured as an array of full `DictionaryEntry`-shaped
 * records so the build script doesn't need to invent translations or
 * phonetics — every field is curated by the data author.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SeedEntry {
  token: string;
  type: 'word' | 'phrase';
  level: 'B1' | 'B2' | 'C1' | 'C2';
  translation: string;
  phonetic?: string;
  bilingual?: string;
  monolingual?: string;
  examples?: string[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DICT_PATH = resolve(ROOT, 'src/assets/dictionaries/en.json');
const SEED_DIR = resolve(ROOT, 'data');

function loadAllSeeds(): SeedEntry[] {
  // Discover every `cefr-*.json` file in `data/` and merge them. This lets
  // the seed grow without having to update the build script every time a
  // new thematic file is added (business / academic / society / etc).
  const files = readdirSync(SEED_DIR)
    .filter((f) => f.startsWith('cefr-') && f.endsWith('.json'))
    .sort();
  const all: SeedEntry[] = [];
  for (const file of files) {
    const path = resolve(SEED_DIR, file);
    const rows: SeedEntry[] = JSON.parse(readFileSync(path, 'utf8'));
    console.log(`  - ${file}: ${rows.length} entries`);
    all.push(...rows);
  }
  return all;
}

function main(): void {
  const dry = process.argv.includes('--dry');
  const dict: Record<string, SeedEntry> = JSON.parse(readFileSync(DICT_PATH, 'utf8'));
  console.log('Loading seed files from data/:');
  const seed = loadAllSeeds();

  const before = Object.keys(dict).length;
  let added = 0;
  let skipped = 0;
  for (const entry of seed) {
    const key = entry.token.toLowerCase();
    if (key in dict) {
      // Only upgrade level/phonetic/bilingual when the curated entry has
      // them and the existing one doesn't — never overwrite a known good
      // translation. We deliberately keep this conservative so re-running
      // the build is a no-op when the dictionary has been hand-tuned.
      const existing = dict[key];
      let changed = false;
      if (!existing.phonetic && entry.phonetic) {
        existing.phonetic = entry.phonetic;
        changed = true;
      }
      if (!existing.bilingual && entry.bilingual) {
        existing.bilingual = entry.bilingual;
        changed = true;
      }
      if (!existing.monolingual && entry.monolingual) {
        existing.monolingual = entry.monolingual;
        changed = true;
      }
      if (!existing.level && entry.level) {
        existing.level = entry.level;
        changed = true;
      }
      if (!existing.examples?.length && entry.examples?.length) {
        existing.examples = entry.examples;
        changed = true;
      }
      if (
        (!existing.translation || existing.translation === '.' || existing.translation.trim() === '') &&
        entry.translation
      ) {
        existing.translation = entry.translation;
        changed = true;
      }
      if (changed) skipped += 1;
      continue;
    }
    dict[key] = {
      token: entry.token,
      type: entry.type,
      level: entry.level,
      translation: entry.translation,
      phonetic: entry.phonetic,
      bilingual: entry.bilingual,
      monolingual: entry.monolingual,
      examples: entry.examples,
    };
    added += 1;
  }

  const after = Object.keys(dict).length;
  console.log(`Seed entries:        ${seed.length}`);
  console.log(`Dictionary before:   ${before}`);
  console.log(`Dictionary after:    ${after}`);
  console.log(`Added (new):         ${added}`);
  console.log(`Upgraded (existing): ${skipped}`);
  if (dry) {
    console.log('--dry: skipping write');
    return;
  }

  // Sort keys alphabetically so diffs stay readable.
  const sorted: Record<string, SeedEntry> = {};
  for (const k of Object.keys(dict).sort()) {
    sorted[k] = dict[k];
  }
  writeFileSync(DICT_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${DICT_PATH}`);
}

main();
