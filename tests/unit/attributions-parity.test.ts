/**
 * Bundes data ↔ ATTRIBUTIONS.md parity.
 *
 * The audit twice found provenance problems: ATTRIBUTIONS.md credited only
 * WordNet while the package ships the Oxford CEFR overlay, NTC idioms, the
 * Academic Collocation List and the Wiktionary-derived MWE index; and the
 * MWE index (built from Wiktionary categories in `scripts/build-mwe-index.cjs`)
 * was labelled plain "project work" while actually carrying CC BY-SA and its
 * ShareAlike obligation.
 *
 * This is a cheap drift alarm, not a licence audit: every bundled dataset that
 * declares `_meta.source` / `_meta.license` must be named here, and anything a
 * build script derives from Wiktionary must carry the CC BY-SA line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIRS = [
  'src/assets/wordnet',
  'src/assets/dictionaries',
  'src/assets/collocations',
  'src/assets/mwes',
  'src/assets/thesaurus',
];

function readMaybe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

describe('ATTRIBUTIONS.md covers the data the package ships', () => {
  it('names every JSON dataset that declares a _meta source or licence', () => {
    const attributions = readFileSync('ATTRIBUTIONS.md', 'utf8');
    const missing: string[] = [];
    for (const dir of DATA_DIRS) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const path = join(dir, entry).replace(/\\/g, '/');
        if (!fileExists(path)) continue;
        let meta: { source?: string; license?: string } | null = null;
        try {
          const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
            _meta?: { source?: string; license?: string };
          };
          meta = parsed._meta ?? null;
        } catch {
          continue;
        }
        if (meta && (meta.source || meta.license)) {
          if (!attributions.includes(path)) missing.push(path);
        }
      }
    }
    expect(missing, 'bundled datasets not mentioned in ATTRIBUTIONS.md: ' + missing.join(', ')).toEqual([]);
  });

  it('credits the Wiktionary-derived MWE index under CC BY-SA', () => {
    // en-mwe-index.json is generated from Wiktionary category enumeration
    // (scripts/build-mwe-index.cjs). CC BY-SA requires attribution, a link to
    // the licence, a note of changes AND ShareAlike for the derived work.
    const buildScript = readFileSync('scripts/build-mwe-index.cjs', 'utf8');
    expect(buildScript).toMatch(/en\.wiktionary\.org/);
    expect(buildScript).toMatch(/CC-?BY-?SA/i);

    const attributions = readFileSync('ATTRIBUTIONS.md', 'utf8');
    expect(attributions).toMatch(/src\/assets\/mwes\/en-mwe-index\.json/);
    expect(attributions).toMatch(/CC BY-SA 4\.0/);
    expect(attributions).toMatch(/ShareAlike|share-?alike/i);
    expect(attributions).toMatch(/wiktionary/i);
    // The key-only modification must be stated: CC BY-SA asks for changed work
    // to be indicated.
    expect(attributions).toMatch(/Modificaci[oó]n/);
  });

  it('says the package is MIT for code and per-file for data', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toMatch(/MIT/);
    expect(readme).toMatch(/ATTRIBUTIONS\.md/);
    // The licence field has to match the LICENSE text, not the README prose only.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { license?: string };
    expect(pkg.license).toBe('MIT');
    expect(readMaybe('LICENSE')).toMatch(/MIT License/);
  });
});
