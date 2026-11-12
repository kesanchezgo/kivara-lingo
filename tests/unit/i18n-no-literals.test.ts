/**
 * No user-facing Spanish may stay in JSX outside the dictionaries.
 *
 * The audit found ~40 hardcoded strings ("Definir", "Voltear", "Proveedor"…)
 * that were invisible to every existing test because each one is a plain
 * string in a props position or a text node. The check is deliberately
 * heuristic — it flags candidates and lets the allowlist carry the
 * exceptions — but a heuristic that misses the shapes is worse than no test,
 * so this version covers ALL of them:
 *
 *  • `prop="…"`, `prop={'…'}` and template literals in props positions;
 *  • text nodes, including ones a formatter splits across lines;
 *  • `title=`, `label=`, `aria-label=` and every other copy-bearing prop (the
 *    NON_COPY list is a denylist of CODE props, not an allowlist);
 *  • `src/options/`, which the earlier version skipped entirely.
 *
 * What it does not do any more: exempt a whole string because its FIRST word
 * is a brand. That exemption is how "Subtitles" hid inside a longer Spanish
 * phrase.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const UI_DIRS = [
  'src/content/ui',
  'src/app/components',
  'src/app/hooks',
  'src/onboarding',
  'src/popup',
  'src/options',
  'src/shared',
  // Added after the service worker was found shipping Spanish to every
  // surface that reaches chrome.i18n: the guard was only auditing the
  // React tree, which is where the old list happened to live.
  'src/background',
  'src/content',
];

/** Props whose value is code or a token, never copy. */
const NON_COPY_PROPS = new Set([
  'className', 'style', 'key', 'id', 'type', 'href', 'src', 'target', 'rel',
  'role', 'viewBox', 'fill', 'stroke', 'd', 'xmlns', 'width', 'height', 'x', 'y',
  'contentEditable', 'autoComplete', 'accept', 'aria-hidden', 'aria-modal',
  'aria-busy', 'section', 'field', 'data-testid', 'forge', 'strokeWidth',
  'strokeLinecap', 'cx', 'cy', 'r', 'accent', 'percent', 'step', 'min', 'max',
  'rows', 'cols', 'name', 'method', 'download', 'loading', 'decoding',
  'crossOrigin', 'muted', 'loop', 'playsInline', 'controls', 'tabIndex', 'value',
  'summary', 'gradientId', 'dominantBaseline', 'xmlSpace',
]);

/** Values that are code, identifiers or unit strings — never human copy. */
const NON_COPY_VALUES =
  /^(auto|off|on|hidden|true|false|none|start|end|left|right|center|top|bottom|remote|vad|mp3|wav|webm|ui|closed|is-open|[a-z0-9-]{1,24}|application\/.*|text\/.*|audio\/.*|image\/.*|\.(zip|csv|tsv|txt|json)|https?:\/\/|\/|#[0-9a-fA-F]{3,8}|#zinc-\d+|zinc-\d+|\d+(\.\d+)?(%|px|ms|s|em|rem)?|Mozilla\/[\w.;+ (),/-]+|[\s\-.·:|/#0-9a-fA-F]*)$/;

/**
 * Whole values that look Spanish to the heuristics but are technical copy:
 * Anki field names, provider ids and enumeration labels.
 */
const LANGUAGE_NEUTRAL_EXACT = new Set([
  'sentence audio', 'note type', 'word', 'source', 'Manual', 'Original',
]);

/**
 * Object properties whose value is always rendered copy. A plain literal in
 * one of these is copy even when the Spanish heuristic cannot see it (an
 * English label, a brand, a one-word enum), so this detection is driven by the
 * property name rather than the language of the value.
 */
const COPY_PROPS = new Set(['label', 'description', 'title', 'hint']);

/** Directories where object-literal copy is held to the i18n rule. */
const OBJECT_PROP_DIRS = ['src/app/', 'src/onboarding/', 'src/content/'];

/** An i18n key held in a lookup table and resolved later with `t(key)`. */
const I18N_KEY_RE = /^[a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/;

/**
 * Unambiguous Spanish function words. A value containing one of these as a
 * whole word is Spanish copy (or about to be), and they never appear in
 * identifiers, class names or unit strings. Accents alone were not enough:
 * "Cerrar panel", "Guardar frase" and "Volver a empezar" carry none.
 */
const SPANISH_STOPWORDS = [
  'cerrar', 'abrir', 'guardar', 'borrar', 'quitar', 'idioma', 'idiomas', 'palabra',
  'palabras', 'frase', 'frases', 'tarjeta', 'tarjetas', 'clave', 'claves', 'ajustes',
  'conexion', 'conexión', 'paquete', 'paquetes', 'mazo', 'modelo', 'campos',
  'campo', 'nivel', 'proveedor', 'proveedores', 'fuente', 'fuentes', 'repetir',
  'voltear', 'restaurar', 'reiniciar', 'actualizar', 'instalar', 'desactivar',
  'activar', 'grabar', 'capturar', 'pausar', 'reanudar', 'enviar', 'probar',
  'limpiar', 'elegir', 'diccionario', 'diccionarios', 'voz', 'voces', 'sinopsis',
  'una', 'unos', 'unas', 'del', 'para', 'como', 'cuando', 'mientras', 'sobre',
  'hasta', 'desde', 'entre', 'durante', 'mediante', 'segun', 'según', 'solo',
  'sólo', 'todo', 'todos', 'todas', 'nuevo', 'nueva', 'otro', 'otra', 'más',
  'aquí', 'no ', 'si ', 'ya ', 'tu ', 'sus ', 'las ', 'los ', 'esa ', 'este ',
];
const STOPWORD_RE = new RegExp(
  `\\b(${SPANISH_STOPWORDS.map((w) => w.trim()).join('|')})\\b`,
  'i',
);

function spanishCandidate(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 140) return false; // a long blob is a comment or an error body
  if (NON_COPY_VALUES.test(t)) return false;
  if (LANGUAGE_NEUTRAL_EXACT.has(t)) return false;
  if (/^[\p{P}\p{S}]+$/u.test(t)) return false; // punctuation/symbol constants ("¡", "¿", "—")
  if (/[áéíóúñÁÉÍÓÚüÜ]|[¡¿]/.test(t)) return true;
  return STOPWORD_RE.test(t);
}

/**
 * Whole literals the raw scan must never flag, each carrying its own reason.
 * Line-independent, so an edit above cannot silently re-activate them.
 */
const LITERAL_EXEMPT_EXACT = new Map<string, string>([
  [
    'Tab audio capture, on-device speech synthesis (TTS fallback) for language learning cards.',
    // chrome.offscreen.createDocument `justification` — browser-facing
    // metadata for chrome://extensions inspection, never rendered in-product.
    'chrome.offscreen justification (browser metadata)',
  ],
]);

/**
 * Spanish phrases the stopword list misses, seen on the background literals
 * this suite widened for ("respuesta mayor de N bytes"). Only the raw-literal
 * and template checks below consult them, so the JSX scan's calibration is
 * untouched.
 */
const EXTRA_SPANISH_RE =
  /\b(no se pudo|no se puede|no se ha|no respondió|no disponible|no permitida|no permitido|mayor de|no se escribió)\b/i;

/**
 * English UI-copy signature: a sentence-shaped literal (4+ words) carrying a
 * strong function/content marker, or a capitalized sentence of 5+ words.
 * Calibrated so that diagnostics never clear the bar — `HTTP ${status}`,
 * `stream idle for N ms`, `timed out` after a stripped interpolation — while
 * user sentences do ("No rows were written for this pack", "terms must be an
 * array", "Fetch failed after all retries").
 */
const ENGLISH_MARKER_RE =
  /\b(the|your|you|please|not|failed|cannot|could|must|should|unavailable|invalid|allowed|again|check|sure|timed out|no longer)\b/i;

function englishCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false; // tokens, mime types, single words
  if (t.length > 160) return false; // long blobs are data, not chrome copy
  if (NON_COPY_VALUES.test(t)) return false;
  if (I18N_KEY_RE.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  if (words.length < 4) return false;
  if (ENGLISH_MARKER_RE.test(t)) return true;
  return /^[A-Z]/.test(t) && words.length >= 5;
}

/** The copy signature for raw literals and template remainders. */
function literalCopy(text: string): boolean {
  const t = text.trim();
  if (LITERAL_EXEMPT_EXACT.has(t)) return false;
  return spanishCandidate(text) || EXTRA_SPANISH_RE.test(text) || englishCandidate(text);
}

/** `${…}` interpolations (one brace-nesting level deep) inside a template. */
const INTERPOLATION_RE = /\$\{(?:[^{}]|\{[^{}]*\})*\}/g;

/** Strip the single-line shapes of `t('…')` / `t("…")` / `t(`…`)` calls, so a
 * translated argument never looks like a bare literal. Key-shaped strings pass
 * the signature anyway; this keeps the intent explicit. */
function stripTCalls(line: string): string {
  return line.replace(
    /\bt\(\s*(['"`])[^'"`]*\1\s*(?:,\s*\{[^}]*\})?\s*\)/g,
    ' ',
  );
}

/** Brands, product names and enum tokens that are the same in both locales. */
const PROPER_NOUNS = new Set([
  'OpenAI', 'Anthropic', 'Google Gemini', 'Gemini', 'WordNet (OEWN 2025)',
  'Wiktionary REST', 'Wiktionary HTML', 'WiktionaryAPI', 'WiktApi / Kaikki',
  'Moby Thesaurus', 'Thesaurus.com', 'WordHippo', 'TheIdioms',
  'Free Dictionary API', 'Datamuse', 'Tatoeba', 'Lingua Libre',
  'Google TTS fallback', 'Bing Images', 'Openverse', 'Wikimedia Commons',
  'DuckDuckGo Images', 'Etymonline', 'YouGlish', 'Britannica Dictionary',
  'Cambridge', 'Oxford', 'Oxford Learner’s', 'Longman LDOCE', 'Dictionary.com',
  'Merriam-Webster', 'M-W Thesaurus', 'Oxford Collocations', 'PONS', 'bab.la',
  'dict.cc', 'Reverso Context', 'Linguee', 'PROMT.One Contexts',
  'WordReference', 'SpanishDict', 'Cambridge audio', 'Oxford audio', 'Forvo',
  'Unsplash (BYOK)', 'Pixabay', 'Yomitan', 'Bundled', 'Word audio',
  'Sentence audio', 'Picture', 'Video link', 'TTS', 'tabCapture', 'Bundle',
  'Packs', 'Remoto', 'Miss', 'Default', 'KivaraLingo', 'Basic',
  'Wiktionary EN→ES', 'Wiktionary EN IPA', 'Wiktionary EN→EN',
]);

/** Tailwind utility tokens (and variants) — never copy. */
const CLASS_TOKEN_RE =
  /^(?:[a-z-]+:)*(?:text|bg|border|ring|shadow|fill|stroke|from|via|to|outline|decoration|divide|placeholder|accent|caret|font|leading|tracking|opacity|rounded|transition|duration|delay|ease|animate|scale|rotate|translate|skew|origin|space|gap|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min|max|flex|grid|inline|block|hidden|absolute|relative|fixed|sticky|top|left|right|bottom|inset|z|overflow|truncate|whitespace|break|align|justify|items|content|self|order|col|row|object|aspect|cursor|select|pointer|resize|sr-only|antialiased|tabular)\b.*$/;

function looksLikeClassList(value: string): boolean {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => CLASS_TOKEN_RE.test(token));
}

/** True when an object property value is a literal the i18n rule forbids. */
export function objectPropCopy(prop: string, value: string): boolean {
  if (!COPY_PROPS.has(prop)) return false;
  const v = value.trim();
  if (!v) return false;
  if (I18N_KEY_RE.test(v)) return false;
  if (PROPER_NOUNS.has(v)) return false;
  if (LANGUAGE_NEUTRAL_EXACT.has(v)) return false;
  if (NON_COPY_VALUES.test(v)) return false;
  if (looksLikeClassList(v)) return false;
  return true;
}

/** Copy legitimately not localized yet, with a reason. Keep this SHORT. */
const ALLOWED: Record<string, string> = {
  // The DALL-E prompt built inline in the save orchestrator is model-facing
  // text — the same family as the ai-*.ts prompt builders (it must describe
  // the word to illustrate, so it stays in the learner's source language).
  'src/background/capture-orchestrator.ts:854':
    'DALL-E prompt text — model-facing, same family as ai-*.ts',
};

/**
 * Whole files/families the raw-literal scan skips, each with the reason it
 * cannot be routed through the dictionaries. Prefix-matched against the
 * repo-relative path (`src/...`, forward slashes).
 */
const ALLOWED_PATHS: Array<{ prefix: string; why: string }> = [
  // AI prompt builders: the text goes to the model, deliberately phrased for
  // the request (language, mnemonics) — it is never rendered as UI copy.
  { prefix: 'src/background/ai-', why: 'AI prompt builders — model-facing text, not UI copy' },
  // Sample data the onboarding/settings previews render as demo card content:
  // it plays a *sample sentence*, the same way a subtitle does.
  { prefix: 'src/shared/preview-data.ts', why: 'sample demo card data, not UI chrome' },
  // The `extra` arrays are mixed-language search ALIASES fed to the settings
  // search index; they exist precisely to match keywords in either language.
  { prefix: 'src/app/components/tabs/settingsSearch.ts', why: 'search aliases are mixed-language keywords by design' },
  // Message-protocol declarations: string literal types are wire tokens.
  { prefix: 'src/shared/protocol.d.ts', why: 'type declarations — protocol tokens, not copy' },
  // Language endonyms render in their OWN language on purpose ("Español",
  // "Deutsch") — translating them would be wrong.
  { prefix: 'src/shared/languages.ts', why: 'endonyms are language data, intentionally untranslated' },
  // The enrichment merger scores learner answers against bilingual gloss and
  // idiom corpora ("to be a piece of cake" / "pan comido"): language data.
  { prefix: 'src/background/enrichment/merge.ts', why: 'gloss/idiom matching corpora, not UI copy' },
  // Scraping sources carry sample usage examples scraped-mirror data and
  // environment guards; the family is owner-owned (cookie/request behaviour
  // decisions live there) and out of this PR's scope.
  { prefix: 'src/background/enrichment/sources/', why: 'source sample data + owner-owned modules (ensureHumanCookie decision)' },
  // Composed etymology prose ("From Middle English given, from Old English
  // giefan…") is DICTIONARY CONTENT in the source language — the same reason
  // Wiktionary definitions ship in English inside the packs. Not chrome copy.
  { prefix: 'src/background/enrichment/phrasal-etymology-fallback.ts', why: 'etymology prose is source-language dictionary content' },
];

/** True when the raw-literal scan must skip `file` entirely. */
function isExemptPath(file: string): boolean {
  return ALLOWED_PATHS.some((a) => file.startsWith(a.prefix));
}

/**
 * Scan one source file. Exported so the self-tests can run the detector over
 * fixtures instead of trusting the repository scan to exercise every branch.
 */
export function scanSource(file: string, src: string): string[] {
  const offenders: string[] = [];
  const seen = new Set<string>();
  const lines = src.split('\n');
  const push = (lineNo: number, shape: string, value: string) => {
    const id = `${file}:${lineNo}`;
    if (ALLOWED[id]) return;
    // One report per line per VALUE, whatever shape caught it first; shapes
    // that quote the same text differently (a template vs its static text)
    // still collapse to one report.
    const dedupe = `${lineNo}|${value.replace(/^[`'"]+|[`'"]+$/g, '')}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    offenders.push(`${id}  ${shape}${value}`);
  };
  const objectProps = OBJECT_PROP_DIRS.some((dir) => file.startsWith(dir));
  // The background worker and shared modules have no JSX, so their hardcoded
  // copy hides in raw literals: interpolated templates and plain strings.
  // Dictionary data files (src/shared/i18n/*) hold every key as a literal and
  // the exempt families are documented above, so both stay out of this scan.
  const rawExempt = file.includes('/shared/i18n/') || isExemptPath(file);
  const rawLiterals =
    (file.startsWith('src/background/') || file.startsWith('src/shared/')) && !rawExempt;
  // console.* diagnostics are developer-facing (worker log), never rendered
  // to the user — skipped, including the multi-line call shapes.
  let inConsoleCall = false;

  lines.forEach((line, i) => {
    const no = i + 1;
    const stripped = line.trim();
    if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) return;

    if (inConsoleCall) {
      // A console call stays open until its closing paren line.
      if (/\)\s*;?\s*$/.test(stripped) && !/console\./.test(stripped)) inConsoleCall = false;
      return;
    }
    if (/^console[.\w]*\./.test(stripped)) {
      // Stay on this line when the call continues below (unclosed parens,
      // ignoring parens inside quotes by checking the rough balance).
      const opens = (stripped.match(/\(/g) ?? []).length;
      const closes = (stripped.match(/\)/g) ?? []).length;
      if (opens > closes) inConsoleCall = true;
      return;
    }

    // `prop="..."`
    for (const m of line.matchAll(/([A-Za-z][\w-]*)="([^"]*)"/g)) {
      const [, prop, value] = m;
      if (NON_COPY_PROPS.has(prop)) continue;
      if (spanishCandidate(value)) push(no, `${prop}="`, `${value}"`);
    }
    // `prop={'...'}`
    for (const m of line.matchAll(/([A-Za-z][\w-]*)=\{'([^']*)'\}/g)) {
      const [, prop, value] = m;
      if (NON_COPY_PROPS.has(prop)) continue;
      if (spanishCandidate(value)) push(no, `${prop}={'`, `${value}'}`);
    }
    // `prop={`...`}`
    for (const m of line.matchAll(/([A-Za-z][\w-]*)=\{`([^`]*)`\}/g)) {
      const [, prop, value] = m;
      if (NON_COPY_PROPS.has(prop)) continue;
      if (spanishCandidate(value)) push(no, `${prop}={`, `\`${value}\``);
    }
    // `label: '...'` / `description: "..."` — object-literal copy.
    if (objectProps) {
      for (const m of line.matchAll(/([A-Za-z][\w-]*)\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g)) {
        const [, prop, , value] = m;
        if (objectPropCopy(prop, value)) push(no, `${prop}: `, `${value}`);
      }
    }
    // `new AnkiConnectError('...')` — the sentence the user reads when Anki
    // fails. A literal here never reached the dictionary, so it ships in one
    // locale only; the argument must be a `t(...)` call (or a variable that
    // already carries its translation).
    for (const m of line.matchAll(/new\s+AnkiConnectError\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) {
      const value = m[1] ?? m[2] ?? m[3] ?? '';
      if (!value.trim() || value.includes('t(')) continue;
      push(no, 'new AnkiConnectError(', value);
    }
    // text nodes on one line: >copy<
    for (const m of line.matchAll(/>\s*([^<>{}\n]{2,80}?)\s*</g)) {
      if (spanishCandidate(m[1])) push(no, '>', `${m[1]}<`);
    }

    // (a) Interpolated template literals — `IA no respondió: ${err}`. The
    // static text around the interpolations is what the user reads, so it
    // must carry the same signature discipline as any literal. Raw templates
    // are scanned everywhere the suite looks; dictionary files hold keys, not
    // copy, and the exempt families are listed with reasons above.
    if (!rawExempt) {
      const cleaned = stripTCalls(line);
      for (const m of cleaned.matchAll(/`(?:[^`\\]|\\.)*`/g)) {
        const raw = m[0];
        if (!raw.includes('${')) continue;
        const staticText = raw.slice(1, -1).replace(INTERPOLATION_RE, ' ');
        if (literalCopy(staticText)) push(no, '`…${…}` ', raw.slice(0, 72));
      }
    }

    // (b) Plain string literals in src/background and src/shared — the Error
    // constructors, warning pushes and return values the user eventually
    // reads. t() arguments, key-shaped strings and technical tokens pass.
    if (rawLiterals) {
      const cleaned = stripTCalls(line);
      for (const m of cleaned.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g)) {
        const value = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"');
        if (!value.trim()) continue;
        if (literalCopy(value)) push(no, "'", value.slice(0, 80));
      }
    }
  });

  // Multi-line text nodes: `>` on one line, copy on the following ones.
  for (let i = 0; i < lines.length; i += 1) {
    if (!/>\s*$/.test(lines[i])) continue;
    if (lines[i].includes('<')) continue; // a real element end, not a JSX block open
    // A block comment that opens with `/**` and has `>` at the end of its
    // opening line (a doc-comment whose first line is long enough to wrap)
    // is prose, not JSX copy.
    if (/\*\s*$/.test(lines[i]) || /^\/\*/.test(lines[i].trim())) continue;
    const parts: string[] = [];
    let end = -1;
    for (let j = i + 1; j < Math.min(lines.length, i + 11); j += 1) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith('<') || trimmed.startsWith('/>')) {
        end = j;
        break;
      }
      // A JSX comment `{/* ... */}`: prose the author wrote, not copy.
      if (trimmed.includes('/*')) break;
      // Expressions (`cond ? a : b`, `&&`, maps, ternaries with a function
      // call) are code, not copy.
      if (/[?&|]|=>|\.map\(|^\}/.test(trimmed)) break;
      const text = trimmed.replace(/^\{?\s*/, '').replace(/\s*\}?$/, '');
      if (text) parts.push(text);
    }
    if (end < 0 || parts.length === 0) continue;
    const joined = parts.join(' ');
    if (!spanishCandidate(joined)) continue;
    const id = `${file}:${i + 2}`;
    if (ALLOWED[id]) continue;
    offenders.push(`${id}  >(multi-line) ${joined.slice(0, 80)}`);
  }

  return offenders;
}

function scannedFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(p.replace(/\\/g, '/'));
      }
    }
  };
  for (const dir of UI_DIRS) {
    try {
      walk(dir);
    } catch {
      /* dir missing */
    }
  }
  return files;
}

describe('no hardcoded Spanish copy in the UI', () => {
  it('sees literals in props, object properties, brace-quoted values and text nodes', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      offenders.push(...scanSource(file, readFileSync(file, 'utf8')));
    }
    expect(offenders, 'Spanish literals left in the UI:\n' + offenders.join('\n')).toEqual([]);
  });

  it('flags object-property copy and passes keys, proper nouns and class lists', () => {
    // Must fail: a plain literal in a copy-bearing property.
    const bad = scanSource(
      'src/app/example.tsx',
      "const meta = { label: 'Cerrar panel', description: 'Otra frase' };",
    );
    expect(bad).toHaveLength(2);
    expect(bad[0]).toContain("label: Cerrar panel");

    // Must pass: keys, brands and styling are not copy.
    const good = scanSource(
      'src/app/example.tsx',
      [
        "const meta = { label: 'panel.close', description: 'cards.srcDescX' };",
        "const brand = { title: 'Cambridge', hint: 'text-zinc-500 dark:text-zinc-400' };",
        "const wired = { label: t('panel.close') };",
      ].join('\n'),
    );
    expect(good).toEqual([]);
  });

  it('flags a literal sentence passed to new AnkiConnectError', () => {
    // Must fail: the three literal shapes — single quote, double quote and a
    // template literal that never calls `t()`.
    const bad = scanSource(
      'src/background/anki-connect.ts',
      [
        "throw new AnkiConnectError('AnkiConnect tardó más de 4000ms en responder.', 'TIMEOUT');",
        "throw new AnkiConnectError(\"Anki URL is not loopback.\", 'LOOPBACK_REFUSED');",
        "throw new AnkiConnectError(`AnkiConnect respondió ${status}.`, 'HTTP');",
      ].join('\n'),
    );
    expect(bad).toHaveLength(3);
    expect(bad[0]).toContain('new AnkiConnectError(AnkiConnect tardó');
    expect(bad[1]).toContain('new AnkiConnectError(Anki URL is not loopback.');
    expect(bad[2]).toContain('new AnkiConnectError(AnkiConnect respondió');

    // Must pass: a translated argument, a template that calls `t()`, and a
    // variable that already carries the provider's own sentence.
    const good = scanSource(
      'src/background/anki-connect.ts',
      [
        "throw new AnkiConnectError(t('anki.timeout', { ms: 4000 }), 'TIMEOUT');",
        "throw new AnkiConnectError(`${t('anki.http', { status })}`, 'HTTP');",
        'throw new AnkiConnectError(message, "ANKI");',
      ].join('\n'),
    );
    expect(good).toEqual([]);
  });

  it('flags interpolated templates and raw literals in background/shared', () => {
    // Must fail: the shapes the background bugs shipped as — a Spanish
    // sentence in a template with an interpolation, a plain Spanish literal in
    // an Error constructor, an English UI sentence, and a shared-module
    // template. One report per line even when two shapes match.
    const bad = scanSource(
      'src/background/example.ts',
      [
        'warnings.push(`IA no respondió: ${result.error}`);',
        "throw new Error('No se pudo guardar el audio');",
        "throw new Error('No rows were written for this pack');",
        "throw new AnkiConnectError('Fonética no disponible', 'PHONETIC');", // two shapes, one report
      ].join('\n'),
    );
    expect(bad).toHaveLength(4);
    expect(bad[0]).toContain('IA no respondió');
    expect(bad[1]).toContain('No se pudo guardar el audio');
    expect(bad[2]).toContain('No rows were written');
    expect(bad[3]).toContain('Fonética no disponible');

    const badShared = scanSource(
      'src/shared/example.ts',
      ['super(`respuesta mayor de ${limit} bytes`);'].join('\n'),
    );
    expect(badShared).toHaveLength(1);
    expect(badShared[0]).toContain('respuesta mayor de');

    // Must pass: technical templates, key-shaped strings, t() arguments and
    // the diagnostic shapes the calibration names.
    const good = scanSource(
      'src/background/example.ts',
      [
        'throw new Error(`HTTP ${res.status}`);',
        'void reader.cancel(new Error(`${what} timed out`)).catch(() => {});',
        "out?.error(new Error(`stream idle for ${idleTimeoutMs} ms`));",
        "warnings.push(t('capture.audioInactive'));",
        "const label = t('capture.noDeck');",
        'const url = `${PACKS_BASE_URL}/kty-en-es.zip`;',
      ].join('\n'),
    );
    expect(good).toEqual([]);
  });

  it('holds raw literals in src/shared to the same rule', () => {
    const bad = scanSource(
      'src/shared/example.ts',
      [
        "throw new UrlNotAllowedError('URL inválida');",
        "super('Cifrado no disponible: la clave no se guardó en texto plano.');",
      ].join('\n'),
    );
    expect(bad).toHaveLength(2);
    expect(bad[0]).toContain('URL inválida');
    expect(bad[1]).toContain('Cifrado no disponible');
  });

  it('passes every allowed family, each for its documented reason', () => {
    const cases: Array<[string, string]> = [
      // AI prompt builders — model-facing text.
      [
        'src/background/ai-providers.ts',
        'const prompt = `Vocabulary mnemonic illustration for the English word "${token}" in context: ${sentence}.`;',
      ],
      // Sample demo content the preview renders as a fake card.
      ['src/shared/preview-data.ts', "nativeSentence: 'Estos días, Nicola no viaja mucho.',"],
      // Mixed-language search aliases.
      [
        'src/app/components/tabs/settingsSearch.ts',
        "extra: ['pack', 'wiktionary', 'diccionario', 'dictionary'],",
      ],
      // Protocol tokens.
      ['src/shared/protocol.d.ts', "type Kind = 'capture.start' | 'capture.stop';"],
      // Endonyms — their own language by design.
      ['src/shared/languages.ts', "{ code: 'es', endonym: 'Español', flag: 'ES' },"],
      // Gloss/idiom matching corpora.
      ['src/background/enrichment/merge.ts', 'if (c === \'pan comido\') { score -= 14; }'],
      // Source sample data / owner-owned modules.
      ['src/background/enrichment/sources/bundled.ts', "guide: 'to organize or be in charge of a business',"],
    ];
    for (const [file, line] of cases) {
      expect(scanSource(file, line), file).toEqual([]);
    }
    // Dictionary data files hold every key as a literal — skipped wholesale.
    expect(
      scanSource('src/shared/i18n/sw.ts', '"capture.noDeck": "No se ha configurado un mazo de Anki.",'),
    ).toEqual([]);
  });

  it('flags a Spanish sentence in a background file through every raw shape', () => {
    // The regression that started this suite widening: one sentence, three
    // shapes, all must be caught.
    const src = [
      'warnings.push(`Fonética no disponible: ${reason}`);',
      "reject(new Error('el documento offscreen no respondió'));",
      'return `Traducción de frase no disponible: ${reason}`;',
    ].join('\n');
    const bad = scanSource('src/background/example.ts', src);
    expect(bad).toHaveLength(3);
    for (const line of bad) {
      expect(line).toMatch(/Fonética|documento offscreen|Traducción de frase/);
    }
  });
});
