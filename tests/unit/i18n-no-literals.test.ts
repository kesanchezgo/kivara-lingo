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
  /^(auto|off|on|hidden|true|false|none|start|end|left|right|center|top|bottom|remote|vad|mp3|wav|webm|ui|closed|is-open|[a-z0-9-]{1,24}|application\/.*|text\/.*|audio\/.*|image\/.*|\.(zip|csv|tsv|txt|json)|https?:\/\/|\/|#[0-9a-fA-F]{3,8}|#zinc-\d+|zinc-\d+|\d+(\.\d+)?(%|px|ms|s|em|rem)?|[\s\-.·:|/#0-9a-fA-F]*)$/;

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
  if (/[áéíóúñÁÉÍÓÚüÜ]|[¡¿]/.test(t)) return true;
  return STOPWORD_RE.test(t);
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
const ALLOWED: Record<string, string> = {};

/**
 * Scan one source file. Exported so the self-tests can run the detector over
 * fixtures instead of trusting the repository scan to exercise every branch.
 */
export function scanSource(file: string, src: string): string[] {
  const offenders: string[] = [];
  const lines = src.split('\n');
  const push = (lineNo: number, shape: string, value: string) => {
    const id = `${file}:${lineNo}`;
    if (ALLOWED[id]) return;
    offenders.push(`${id}  ${shape}${value}`);
  };
  const objectProps = OBJECT_PROP_DIRS.some((dir) => file.startsWith(dir));

  lines.forEach((line, i) => {
    const no = i + 1;
    const stripped = line.trim();
    if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) return;

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
});
