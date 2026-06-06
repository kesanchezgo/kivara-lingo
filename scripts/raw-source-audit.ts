import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface RawSourceConfig {
  id: string;
  tier: 'standard' | 'vip' | 'candidate-standard' | 'candidate-vip';
  role: string[];
  qualityHypothesis: string;
  urls: (token: string) => string[];
  headers?: Record<string, string>;
}

const WORDS = [
  'give',
  'wonderful',
  'anything',
  'anybody',
  'week',
  'know',
  'run',
  'break up',
  'piece of cake',
  'make a decision',
  'look up',
  'get over',
];

const BROWSER_HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'en-US,en;q=0.9,es;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
};

function slug(token: string): string {
  return encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
}

function q(token: string): string {
  return encodeURIComponent(token.trim());
}

const sources: RawSourceConfig[] = [
  {
    id: 'cambridge',
    tier: 'vip',
    role: ['bilingual', 'monolingual', 'examples', 'phonetic', 'audio'],
    qualityHypothesis: 'Recognized bilingual learner dictionary. Raw HTML contains lexical translations plus translated examples that must be separated by sense blocks.',
    urls: (t) => [`https://dictionary.cambridge.org/us/dictionary/english-spanish/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'oxfordLearners',
    tier: 'vip',
    role: ['monolingual', 'examples', 'phonetic', 'audio', 'collocations'],
    qualityHypothesis: 'High quality learner definitions and audio. Not a bilingual ES source.',
    urls: (t) => [`https://www.oxfordlearnersdictionaries.com/us/definition/english/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'longman',
    tier: 'vip',
    role: ['monolingual', 'examples', 'phonetic', 'audio', 'collocations'],
    qualityHypothesis: 'High quality learner definitions/examples. Often better than FreeDictionary for primary monolingual sense.',
    urls: (t) => [`https://www.ldoceonline.com/dictionary/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'collins',
    tier: 'vip',
    role: ['monolingual', 'examples', 'phonetic', 'audio', 'bilingual'],
    qualityHypothesis: 'Recognized dictionary, but scraper must verify whether EN-ES or English-only page is returned for each token.',
    urls: (t) => [`https://www.collinsdictionary.com/dictionary/english-spanish/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'merriamWebster',
    tier: 'vip',
    role: ['monolingual', 'examples', 'phonetic', 'audio', 'etymology'],
    qualityHypothesis: 'Good English dictionary/thesaurus/etymology source. Not bilingual ES.',
    urls: (t) => [`https://www.merriam-webster.com/dictionary/${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'ozdic',
    tier: 'vip',
    role: ['collocations', 'examples'],
    qualityHypothesis: 'Collocation source. Must preserve grammatical groupings and not treat repeated headings as definitions.',
    urls: (t) => [`https://ozdic.com/collocation/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'reverso',
    tier: 'vip',
    role: ['bilingual', 'examples'],
    qualityHypothesis: 'Contextual examples/translations. Useful if parser separates phrase examples from lexical glosses.',
    urls: (t) => [`https://context.reverso.net/translation/english-spanish/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'linguee',
    tier: 'vip',
    role: ['bilingual', 'examples'],
    qualityHypothesis: 'Translation memory and dictionary. Must separate dictionary table from corpus examples.',
    urls: (t) => [`https://www.linguee.com/english-spanish/search?source=auto&query=${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'wordReference',
    tier: 'vip',
    role: ['bilingual', 'examples', 'audio', 'forum-links'],
    qualityHypothesis: 'Strong EN-ES dictionary. Raw rows include grammar labels and compounds that must be parsed into lexical entries vs examples/expressions.',
    urls: (t) => [`https://www.wordreference.com/es/translation.asp?tranword=${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'spanishDict',
    tier: 'vip',
    role: ['bilingual', 'examples', 'conjugation'],
    qualityHypothesis: 'Strong EN-ES source. Raw page can include phrase examples and conjugations that must not pollute bilingual gloss.',
    urls: (t) => [`https://www.spanishdict.com/translate/${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'forvo',
    tier: 'vip',
    role: ['audio'],
    qualityHypothesis: 'Native pronunciation source where page is accessible. Requires careful handling because listings vary by word.',
    urls: (t) => [`https://forvo.com/word/${slug(t)}/#en`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'freeDictionary',
    tier: 'standard',
    role: ['monolingual', 'examples', 'phonetic', 'audio', 'synonyms', 'antonyms'],
    qualityHypothesis: 'Structured JSON, good fallback, but first sense can be wrong for polysemy.',
    urls: (t) => [`https://api.dictionaryapi.dev/api/v2/entries/en/${q(t)}`],
    headers: { accept: 'application/json' },
  },
  {
    id: 'datamuse',
    tier: 'standard',
    role: ['synonyms', 'antonyms', 'collocations'],
    qualityHypothesis: 'Structured JSON. High recall but collocations are noisy and need strong filtering.',
    urls: (t) => [`https://api.datamuse.com/words?ml=${q(t)}&md=dps&max=50`, `https://api.datamuse.com/words?rel_trg=${q(t)}&max=50`],
    headers: { accept: 'application/json' },
  },
  {
    id: 'wiktionaryRest',
    tier: 'standard',
    role: ['monolingual', 'examples', 'phonetic'],
    qualityHypothesis: 'Official rendered/REST data can be useful but often requires HTML parsing.',
    urls: (t) => [`https://en.wiktionary.org/api/rest_v1/page/definition/${q(t)}`],
    headers: { accept: 'application/json' },
  },
  {
    id: 'wiktionaryHtml',
    tier: 'standard',
    role: ['monolingual', 'examples', 'translations', 'etymology', 'pronunciation'],
    qualityHypothesis: 'Very rich raw HTML. Parser must separate language sections, POS, translations, examples, etymology and audio.',
    urls: (t) => [`https://en.wiktionary.org/wiki/${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'wiktApi',
    tier: 'candidate-standard',
    role: ['monolingual', 'translations', 'examples', 'phonetic', 'audio', 'forms', 'etymology'],
    qualityHypothesis: 'Structured JSON over Kaikki/Wiktextract. Candidate to replace fragile Wiktionary HTML parsing if endpoint proves stable.',
    urls: (t) => [`https://api.wiktapi.dev/v1/en/word/${q(t)}?lang=en`, `https://api.wiktapi.dev/v1/en/word/${q(t)}/translations?lang=en`, `https://api.wiktapi.dev/v1/en/word/${q(t)}/pronunciations?lang=en`],
    headers: { accept: 'application/json' },
  },
  {
    id: 'babla',
    tier: 'candidate-vip',
    role: ['bilingual', 'examples', 'idioms', 'phrasal-verbs', 'conjugation-links'],
    qualityHypothesis: 'Recognized free dictionary page with Oxford-powered sections, translations, examples, idioms and phrasals. Very promising but parser must separate sections.',
    urls: (t) => [`https://en.bab.la/dictionary/english-spanish/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'pons',
    tier: 'candidate-vip',
    role: ['bilingual', 'examples', 'sense-groups', 'audio'],
    qualityHypothesis: 'Recognized free dictionary. Raw page contains sense groups and aligned examples. Promising VIP candidate after parser audit.',
    urls: (t) => [`https://en.pons.com/translate/english-spanish/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'dictcc',
    tier: 'candidate-vip',
    role: ['bilingual', 'phrases', 'domain-labels', 'audio-icons'],
    qualityHypothesis: 'Free bilingual dictionary with table rows, domain labels and phrase translations. Needs parser to split single-word vs phrase rows.',
    urls: (t) => [`https://enes.dict.cc/?s=${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'britannicaDictionary',
    tier: 'candidate-standard',
    role: ['monolingual', 'examples', 'phrasal-verbs', 'idioms', 'pronunciation'],
    qualityHypothesis: 'Free learner dictionary with extensive simple definitions/examples. Candidate for Standard monolingual quality improvement.',
    urls: (t) => [`https://www.britannica.com/dictionary/${q(t)}`],
    headers: BROWSER_HEADERS,
  },
];

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function safeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const root = join('docs', 'reports', 'raw-source-audit', date);
  mkdirSync(root, { recursive: true });
  const fullRaw = process.argv.includes('--full-raw') || process.env.FULL_RAW === '1';
  const tokensArg = process.argv.find((arg) => arg.startsWith('--tokens='));
  const selectedTokens = tokensArg ? tokensArg.slice('--tokens='.length).split(',').map((s) => s.trim()).filter(Boolean) : WORDS;
  const sourcesArg = process.argv.find((arg) => arg.startsWith('--sources='));
  const selectedSourceIds = sourcesArg ? new Set(sourcesArg.slice('--sources='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const selectedSources = selectedSourceIds ? sources.filter((s) => selectedSourceIds.has(s.id)) : sources;

  const report: any = {
    generatedAt: new Date().toISOString(),
    fullRaw,
    tokens: selectedTokens,
    sources: selectedSources.map(({ id, tier, role, qualityHypothesis }) => ({ id, tier, role, qualityHypothesis })),
    results: [],
  };

  for (const source of selectedSources) {
    for (const token of selectedTokens) {
      for (const url of source.urls(token)) {
        const started = Date.now();
        const dir = join(root, source.id, safeName(token));
        mkdirSync(dir, { recursive: true });
        try {
          const { res, text } = await fetchWithTimeout(url, { headers: source.headers ?? BROWSER_HEADERS });
          const contentType = res.headers.get('content-type') ?? '';
          const entry = {
            sourceId: source.id,
            tier: source.tier,
            token,
            url,
            finalUrl: res.url,
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            ms: Date.now() - started,
            contentType,
            bytes: Buffer.byteLength(text, 'utf8'),
            sha256: sha256(text),
            bodySample: text.slice(0, 6000),
            savedRawPath: fullRaw ? join(dir, `${safeName(url)}.raw`) : undefined,
          };
          if (fullRaw) writeFileSync(join(dir, `${safeName(url)}.raw`), text);
          writeFileSync(join(dir, `${safeName(url)}.meta.json`), JSON.stringify(entry, null, 2));
          report.results.push(entry);
          console.log(`${source.id} ${token} ${res.status} ${entry.bytes}B ${entry.ms}ms`);
        } catch (err) {
          const entry = {
            sourceId: source.id,
            tier: source.tier,
            token,
            url,
            ok: false,
            ms: Date.now() - started,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          };
          writeFileSync(join(dir, `${safeName(url)}.error.json`), JSON.stringify(entry, null, 2));
          report.results.push(entry);
          console.log(`${source.id} ${token} ERROR ${entry.error}`);
        }
      }
    }
  }

  const summaryFile = join(root, 'summary.json');
  writeFileSync(summaryFile, JSON.stringify(report, null, 2));
  console.log(`WROTE ${summaryFile}`);
}

await main();
