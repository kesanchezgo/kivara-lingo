import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

interface SourceConfig {
  id: string;
  tier: 'candidate-standard' | 'candidate-vip';
  urls: (token: string) => string[];
  headers: Record<string, string>;
}

const BROWSER_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'en-US,en;q=0.9,es;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
};

const BABLA_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,es;q=0.8',
  'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

const JSON_HEADERS = { accept: 'application/json' };

function q(token: string): string {
  return encodeURIComponent(token.trim());
}

function slug(token: string): string {
  return encodeURIComponent(token.trim().toLowerCase().replace(/\s+/g, '-'));
}

const SOURCES: SourceConfig[] = [
  {
    id: 'pons',
    tier: 'candidate-vip',
    urls: (t) => [`https://en.pons.com/translate/english-spanish/${slug(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'babla',
    tier: 'candidate-vip',
    urls: (t) => [`https://en.bab.la/dictionary/english-spanish/${slug(t)}`],
    headers: BABLA_HEADERS,
  },
  {
    id: 'dictcc',
    tier: 'candidate-vip',
    urls: (t) => [`https://enes.dict.cc/?s=${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'britannicaDictionary',
    tier: 'candidate-standard',
    urls: (t) => [`https://www.britannica.com/dictionary/${q(t)}`],
    headers: BROWSER_HEADERS,
  },
  {
    id: 'wiktApi',
    tier: 'candidate-standard',
    urls: (t) => [
      `https://api.wiktapi.dev/v1/en/word/${q(t)}?lang=en`,
      `https://api.wiktapi.dev/v1/en/word/${q(t)}/translations?lang=en`,
      `https://api.wiktapi.dev/v1/en/word/${q(t)}/pronunciations?lang=en`,
    ],
    headers: JSON_HEADERS,
  },
];

const DEFAULT_TOKENS = [
  'give',
  'wonderful',
  'anything',
  'anybody',
  'week',
  'know',
  'run',
  'break up',
  'piece of cake',
];

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function safeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToLines(html: string): string[] {
  const text = decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h\d|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n');
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 1);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function takeUseful(lines: string[], regex: RegExp, max = 20): string[] {
  return unique(lines.filter((line) => regex.test(line))).slice(0, max);
}

function extractSpanishLinks(html: string): string[] {
  const matches = [...html.matchAll(/\/translate\/spanish-english\/([^"?#<]+)/g)]
    .map((m) => decodeURIComponent(m[1]).replace(/-/g, ' ').trim())
    .filter(Boolean);
  return unique(matches).slice(0, 80);
}

function extractBabLaTranslationAnchors(html: string): string[] {
  const matches = [...html.matchAll(/dictionary\/english-spanish\/[^#"']+#translations-es\d+[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => htmlToLines(m[1]).join(' ').trim())
    .filter(Boolean);
  return unique(matches).slice(0, 80);
}

function snapshotHtml(sourceId: string, html: string) {
  const lines = htmlToLines(html);
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
  const audioUrls = unique([
    ...[...html.matchAll(/https?:\/\/[^"'\s>]+\.(?:mp3|ogg|wav)(?:\?[^"'\s>]*)?/gi)].map((m) => m[0]),
    ...hrefs.filter((h) => /audio|pronunciation|tts|sound|mp3|ogg|wav/i.test(h)),
  ]).slice(0, 40);

  const result: Record<string, unknown> = {
    lineCount: lines.length,
    htmlSize: html.length,
    sha256: hash(html),
    firstLines: lines.slice(0, 80),
    headings: takeUseful(lines, /^(I\.|II\.|III\.|\d+\.|[A-Z][A-Za-z ]+:|Translations|Examples|Idioms|Phrasal verbs|Britannica Dictionary definition|Oxford Spanish Dictionary)/, 60),
    audioHints: audioUrls,
  };

  if (sourceId === 'pons') {
    result.spanishLinkCandidates = extractSpanishLinks(html);
    result.senseHeadings = takeUseful(lines, /^\d+(\.\d+)?\.\s+.+|^I\.\s+.+|^II\.\s+.+/, 80);
    result.exampleLikeLines = takeUseful(lines, /\b(give|wonderful|anything|anybody|week|know|run|break up|piece of cake)\b/i, 80);
  }

  if (sourceId === 'babla') {
    result.translationAnchors = extractBabLaTranslationAnchors(html);
    result.sectionLines = takeUseful(lines, /^(".+" in Spanish|Translations|Spanish translations powered by Oxford Languages|idioms|phrasal verbs|Monolingual examples|EN|ES|give|wonderful|anything)/i, 100);
    result.exampleLikeLines = takeUseful(lines, /open_in_new|Request revision|\b(give|wonderful|anything|anybody|week|know|run)\b/i, 80);
  }

  if (sourceId === 'dictcc') {
    result.tableLikeLines = takeUseful(lines, /\b(to |NOUN|VERB|Words:|Translation \d|Spanish|English|\[.+\])/, 120);
    result.spanishLinkCandidates = [...new Set([...html.matchAll(/enes\.dict\.cc\/\?s=([^"'&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')))].slice(0, 80);
  }

  if (sourceId === 'britannicaDictionary') {
    result.definitionLines = takeUseful(lines, /^\d+$|^\[\+ object\]|^[a-z]:|^Britannica Dictionary definition|^:to |^— used|^give /i, 120);
    result.exampleLines = takeUseful(lines, /^-\s|\b_give_|\bgave\b|\bgiven\b/i, 80);
  }

  return result;
}

function snapshotJson(url: string, text: string) {
  const parsed = JSON.parse(text);
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return {
    jsonSize: text.length,
    sha256: hash(text),
    topLevelKeys: Object.keys(parsed),
    entryCount: entries.length,
    entries: entries.slice(0, 8).map((entry: any) => ({
      word: entry.word,
      lang: entry.lang,
      lang_code: entry.lang_code,
      pos: entry.pos,
      keys: Object.keys(entry),
      senses: entry.senses?.slice?.(0, 4)?.map((sense: any) => ({
        glosses: sense.glosses,
        raw_glosses: sense.raw_glosses,
        examples: sense.examples?.slice?.(0, 3),
        translations: sense.translations?.slice?.(0, 8),
        tags: sense.tags,
      })),
      sounds: entry.sounds?.slice?.(0, 6),
      forms: entry.forms?.slice?.(0, 8),
      translations: entry.translations?.slice?.(0, 12),
      etymology_text: entry.etymology_text,
    })),
    endpointKind: url.includes('/translations') ? 'translations' : url.includes('/pronunciations') ? 'pronunciations' : 'full-entry',
  };
}

async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    return { res, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const root = join('docs', 'reports', 'parser-snapshots', date);
  mkdirSync(root, { recursive: true });

  const tokensArg = process.argv.find((arg) => arg.startsWith('--tokens='));
  const sourceArg = process.argv.find((arg) => arg.startsWith('--sources='));
  const tokens = tokensArg ? tokensArg.slice('--tokens='.length).split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_TOKENS;
  const sourceIds = sourceArg ? new Set(sourceArg.slice('--sources='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const sources = sourceIds ? SOURCES.filter((source) => sourceIds.has(source.id)) : SOURCES;

  const report: any = {
    generatedAt: new Date().toISOString(),
    tokens,
    sources: sources.map(({ id, tier }) => ({ id, tier })),
    snapshots: [],
  };

  for (const source of sources) {
    for (const token of tokens) {
      const outDir = join(root, source.id, safeName(token));
      mkdirSync(outDir, { recursive: true });
      for (const url of source.urls(token)) {
        const started = Date.now();
        try {
          const { res, text } = await fetchWithTimeout(url, source.headers);
          const contentType = res.headers.get('content-type') ?? '';
          const snapshot = contentType.includes('json') || url.includes('api.wiktapi.dev')
            ? snapshotJson(url, text)
            : snapshotHtml(source.id, text);
          const payload = {
            sourceId: source.id,
            tier: source.tier,
            token,
            url,
            finalUrl: res.url,
            ok: res.ok,
            status: res.status,
            contentType,
            bytes: Buffer.byteLength(text, 'utf8'),
            ms: Date.now() - started,
            snapshot,
          };
          const file = join(outDir, `${safeName(url)}.parser.json`);
          writeFileSync(file, JSON.stringify(payload, null, 2));
          report.snapshots.push({ ...payload, snapshotFile: file, snapshot: undefined });
          console.log(`${source.id} ${token} ${res.status} ${payload.bytes}B -> ${file}`);
        } catch (err) {
          const payload = {
            sourceId: source.id,
            tier: source.tier,
            token,
            url,
            ok: false,
            ms: Date.now() - started,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          };
          const file = join(outDir, `${safeName(url)}.error.json`);
          writeFileSync(file, JSON.stringify(payload, null, 2));
          report.snapshots.push({ ...payload, snapshotFile: file });
          console.log(`${source.id} ${token} ERROR ${payload.error}`);
        }
      }
    }
  }

  const summary = join(root, 'summary.json');
  writeFileSync(summary, JSON.stringify(report, null, 2));
  console.log(`WROTE ${summary}`);
}

await main();
