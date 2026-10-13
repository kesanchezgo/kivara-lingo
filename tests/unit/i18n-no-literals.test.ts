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

/** Copy legitimately not localized yet, with a reason. Keep this SHORT. */
const ALLOWED: Record<string, string> = {};

describe('no hardcoded Spanish copy in the UI', () => {
  it('sees literals in props, brace-quoted values and text nodes', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      const push = (lineNo: number, shape: string, value: string) => {
        const id = `${file}:${lineNo}`;
        if (ALLOWED[id]) return;
        offenders.push(`${id}  ${shape}${value}`);
      };

      lines.forEach((line, i) => {
        const no = i + 1;
        const stripped = line.trim();
        if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) return;

        // `prop="…"`
        for (const m of line.matchAll(/([A-Za-z][\w-]*)="([^"]*)"/g)) {
          const [, prop, value] = m;
          if (NON_COPY_PROPS.has(prop)) continue;
          if (spanishCandidate(value)) push(no, `${prop}="`, `${value}"`);
        }
        // `prop={'…'}`
        for (const m of line.matchAll(/([A-Za-z][\w-]*)=\{'([^']*)'\}/g)) {
          const [, prop, value] = m;
          if (NON_COPY_PROPS.has(prop)) continue;
          if (spanishCandidate(value)) push(no, `${prop}={'`, `${value}'}`);
        }
        // `prop={`…`}`
        for (const m of line.matchAll(/([A-Za-z][\w-]*)=\{`([^`]*)`\}/g)) {
          const [, prop, value] = m;
          if (NON_COPY_PROPS.has(prop)) continue;
          if (spanishCandidate(value)) push(no, `${prop}={`, `\`${value}\`}`);
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
          // A JSX comment `{/* … */}`: prose the author wrote, not copy.
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
    }
    expect(offenders, 'Spanish literals left in the UI:\n' + offenders.join('\n')).toEqual([]);
  });
});
