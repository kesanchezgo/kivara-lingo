import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const OEWN_VERSION = '2025';
const OEWN_URL = `https://en-word.net/static/english-wordnet-${OEWN_VERSION}-json.zip`;
const outputDir = resolve('src/assets/wordnet');
const suppliedArchive = process.argv[2] ? resolve(process.argv[2]) : undefined;

interface RawSense {
  synset?: string;
  antonym?: string[];
}

interface RawEntryPart {
  sense?: RawSense[];
}

interface RawSynset {
  definition?: string[];
  example?: Array<string | { text?: string }>;
  members?: string[];
  partOfSpeech?: string;
}

interface CompactSense {
  i: string;
  p: string;
  d: string;
  e?: string[];
  s?: string[];
  a?: string[];
}

type CompactShard = Record<string, CompactSense[]>;

function normalizeLemma(value: string): string {
  return value.replaceAll('_', ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function lemmaFromSenseKey(value: string): string {
  return normalizeLemma(value.split('%', 1)[0] ?? '');
}

function shardFor(lemma: string): string {
  const first = lemma.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')[0]?.toLowerCase();
  return first && /[a-z]/.test(first) ? first : 'other';
}

async function loadArchive(): Promise<{ bytes: Uint8Array; temporary: boolean }> {
  if (suppliedArchive) return { bytes: new Uint8Array(await readFile(suppliedArchive)), temporary: false };
  const response = await fetch(OEWN_URL);
  if (!response.ok) throw new Error(`OEWN download failed: HTTP ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), temporary: true };
}

const { bytes } = await loadArchive();
const archive = unzipSync(bytes);
const decoder = new TextDecoder();
const synsets = new Map<string, RawSynset>();
const entryFiles: Array<[string, Uint8Array]> = [];

for (const [path, contents] of Object.entries(archive)) {
  const name = basename(path);
  if (!name.endsWith('.json') || name === 'frames.json') continue;
  if (name.startsWith('entries-')) {
    entryFiles.push([name, contents]);
    continue;
  }
  const records = JSON.parse(decoder.decode(contents)) as Record<string, RawSynset>;
  for (const [id, synset] of Object.entries(records)) synsets.set(id, synset);
}

const shards: Record<string, CompactShard> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyz', 'other'].map((key) => [key, {}]),
);
let lemmaCount = 0;
let senseCount = 0;

for (const [, contents] of entryFiles.sort(([a], [b]) => a.localeCompare(b))) {
  const entries = JSON.parse(decoder.decode(contents)) as Record<string, Record<string, RawEntryPart>>;
  for (const [rawLemma, parts] of Object.entries(entries)) {
    const lemma = normalizeLemma(rawLemma);
    if (!lemma) continue;
    const compact: CompactSense[] = [];
    for (const [entryPos, part] of Object.entries(parts)) {
      for (const sense of part.sense ?? []) {
        if (!sense.synset) continue;
        const synset = synsets.get(sense.synset);
        const definition = synset?.definition?.find(Boolean)?.trim();
        if (!synset || !definition) continue;
        const synonyms = [...new Set((synset.members ?? []).map(normalizeLemma))]
          .filter((member) => member && member !== lemma)
          .slice(0, 16);
        const antonyms = [...new Set((sense.antonym ?? []).map(lemmaFromSenseKey))]
          .filter((member) => member && member !== lemma)
          .slice(0, 8);
        const examples = (synset.example ?? [])
          .map((example) => (typeof example === 'string' ? example : example.text ?? '').trim())
          .filter(Boolean)
          .slice(0, 2);
        compact.push({
          i: sense.synset,
          p: synset.partOfSpeech ?? entryPos,
          d: definition,
          ...(examples.length ? { e: examples } : {}),
          ...(synonyms.length ? { s: synonyms } : {}),
          ...(antonyms.length ? { a: antonyms } : {}),
        });
      }
    }
    if (!compact.length) continue;
    shards[shardFor(lemma)][lemma] = compact;
    lemmaCount += 1;
    senseCount += compact.length;
  }
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const [key, shard] of Object.entries(shards)) {
  await writeFile(join(outputDir, `${key}.json`), JSON.stringify(shard));
}
await writeFile(join(outputDir, 'metadata.json'), JSON.stringify({
  name: 'Open English WordNet',
  version: OEWN_VERSION,
  source: 'https://en-word.net/',
  originalArtifact: OEWN_URL,
  originalFormat: 'Official JSON ZIP',
  generatedAt: new Date().toISOString(),
  transformation: 'Indexed by normalized lemma and reduced to synset ID, POS, definition, examples, synonyms and antonyms.',
  lemmaCount,
  senseCount,
  licenses: ['CC BY 4.0', 'Princeton WordNet License'],
}, null, 2));

console.log(`Generated OEWN ${OEWN_VERSION}: ${lemmaCount} lemmas, ${senseCount} senses in ${outputDir}`);
