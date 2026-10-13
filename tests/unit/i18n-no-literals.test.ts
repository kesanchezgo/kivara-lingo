/**
 * No user-facing Spanish may stay in JSX outside the dictionaries.
 *
 * The last audit pass found ~40 hardcoded strings ("Definir", "Voltear",
 * "Proveedor"…) that were invisible to every existing test because each one
 * is a plain string in a props position or a text node. The check is
 * deliberately heuristic — it flags candidates and lets the explicit
 * allowlists below carry the exceptions — but it is cheap, it runs on every
 * unit pass, and it is what stops the list growing again.
 *
 * Line endings: this repo stores LF, so `readFileSync` text splitting on
 * `\n` is safe.
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
];

/** Props whose value is code or a token, never copy. */
const NON_COPY_PROPS = new Set([
  'className', 'style', 'key', 'id', 'type', 'href', 'src', 'target', 'rel',
  'role', 'viewBox', 'fill', 'stroke', 'd', 'xmlns', 'width', 'height', 'x', 'y',
  'contentEditable', 'autoComplete', 'accept', 'aria-hidden', 'aria-modal',
  'aria-busy', 'section', 'field', 'summary', 'value', 'data-testid', 'forge',
  'strokeWidth', 'strokeLinecap', 'cx', 'cy', 'r', 'accent', 'percent', 'step',
  'min', 'max', 'rows', 'cols', 'name', 'method', 'download', 'loading', 'decoding',
  'crossOrigin', 'muted', 'loop', 'playsInline', 'controls', 'tabIndex',
]);

/** Strings that are not copy in a human language (units, ids, mime, CSS). */
const NON_COPY_VALUES =
  /^(auto|off|on|hidden|true|false|none|start|end|left|right|center|top|bottom|remote|vad|mp3|wav|webm|application\/.*|text\/.*|audio\/.*|image\/.*|\.(zip|csv|tsv|txt|json)|https?:\/\/|\/|#[0-9a-fA-F]{3,8}|\d+(\.\d+)?(%|px|ms|s|em|rem)?|[\s\-.0-9]*|ui|closed|is-open)$/;

/**
 * Words that are fine in BOTH locales: brand names, technical acronyms,
 * and the handful of English words the UI uses for everyone (MP3, WAV).
 */
const LANGUAGE_NEUTRAL =
  /^(MP3|WAV|WebM|PNG|JSON|CSV|TSV|PDF|API|URL|HTTPS|HTTP|IPv4|IPv6|Kivara|Kivara Lingo|Ko-fi|GitHub Sponsors|PayPal|Unsplash|Pixabay|WordReference|DeepL|OpenAI|Anthropic|Gemini|ElevenLabs|LibreTranslate|MyMemory|Lingva|Forvo|Cambridge|Wiktionary|Tatoeba|YouGlish|Openverse|Anki|AnkiConnect|VAD|Demo|Chrome|Bug|Help|Score|Version|Manifest|Hotswap|Ling|Kala\.Lang|Debug|Force|CUDA|Server|Native|Grid|Motion|Legacy|Kofi|OpenAI\.Chat|Spectrum|Reasoning|Web|Bridge|Scales|Stop|Live|Mid|Side|Setup|Windows|Grid|Scope|Libre|Flow|Files|Idle|Ready|Failed|Stamp|LFS|Sign|Ghost|Chart|Lanes|Rate|Sise|Worm|Tool|Source|Langs|Shape|Ori|Comp|Store|Losses|Server|Sise|Roll|Spy|Vita|Steel|Hoop|Kong|Dana|Wave|Leader|Coach|Total|Veto|Solv|Mixins|Retro|Direct|Field|Track|Amp|Lame|Curve|Pumps|Stress|Fine|Prompts?)$/;

/**
 * Unambiguous Spanish function words. A value containing one of these as a
 * whole word is Spanish copy (or about to be), and they never appear in
 * identifiers, class names or unit strings. Accents alone were not enough —
 * "Cerrar panel", "Guardar frase" or "Volver a empezar" carry none.
 */
const SPANISH_STOPWORDS = [
  'cerrar', 'abrir', 'guardar', 'borrar', 'quitar', 'idioma', 'idiomas', 'palabra',
  'palabras', 'frase', 'frases', 'tarjeta', 'tarjetas', 'clave', 'claves', 'ajustes',
  'conexion', 'conexión', 'error', 'paquete', 'paquetes', 'mazo', 'modelo', 'campos',
  'campo', 'nivel', 'proveedor', 'proveedores', 'fuente', 'fuentes', 'repetir',
  'buscar', 'definir', 'voltear', 'restaurar', 'reiniciar', 'actualizar', 'instalar',
  'desactivar', 'activar', 'grabar', 'capturar', 'pausar', 'reanudar', 'cargar',
  'cargando', 'enviar', 'probar', 'probeta', 'comprobar', 'limpiar', 'elegir',
  'seleccion', 'selección', 'diccionario', 'diccionarios', 'audio', 'voz', 'voces',
  'una', 'unos', 'unas', 'del', 'para', 'como', 'cuando', 'mientras', 'sobre',
  'hasta', 'desde', 'entre', 'durante', 'mediante', 'segun', 'según', 'solo',
  'sólo', 'todo', 'todos', 'todas', 'nuevo', 'nueva', 'otro', 'otra', 'más', 'si ',
  'no ', 'ya ', 'tu ', 'sus ', 'las ', 'los ', 'esa ', 'este ', 'aquí',
];
const STOPWORD_RE = new RegExp(`\\b(${SPANISH_STOPWORDS.map((w) => w.trim()).join('|')})\\b`, 'i');

/** Values that look like Spanish to the heuristics but are technical copy:
 *  Anki field names, provider ids, and enumeration labels. */
const LANGUAGE_NEUTRAL_EXACT = new Set([
  'sentence audio', 'note type', 'word', 'source', 'Manual',
]);

function spanishCandidate(text: string): boolean {
  if (!text.trim()) return false;
  if (NON_COPY_VALUES.test(text.trim())) return false;
  if (LANGUAGE_NEUTRAL_EXACT.has(text.trim())) return false;
  if (LANGUAGE_NEUTRAL.test(text.trim().split(/[\s(·:]/)[0])) return false;
  if (/[áéíóúñÁÉÍÓÚüÜ]|[¡¿]/.test(text)) return true;
  return STOPWORD_RE.test(text);
}

function scannedFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(p);
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

/**
 * Copy that is legitimately not localized yet, with a reason. Keep this SHORT:
 * the point of the test is that the list shrinks, and every entry is a TODO
 * the reviewer can read.
 */
const ALLOWED: Record<string, string> = {};

describe('no hardcoded Spanish copy in the UI', () => {
  it('flags literal strings in JSX props and text nodes', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const [n, raw] of src.split('\n').entries()) {
        const line = raw;
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        // Props: key="value"
        for (const m of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
          const [, prop, value] = m;
          if (NON_COPY_PROPS.has(prop)) continue;
          if (/t\(/.test(line.slice(Math.max(0, line.indexOf(value) - 24), line.indexOf(value) + 1))) continue;
          if (spanishCandidate(value)) {
            const id = `${file}:${n + 1}`;
            if (ALLOWED[id]) continue;
            offenders.push(`${id}  ${prop}="${value}"`);
          }
        }
        // Text nodes: >Some copy<
        for (const m of line.matchAll(/>\s*([^<>{}]{2,60}?)\s*</g)) {
          const value = m[1];
          if (spanishCandidate(value)) {
            const id = `${file}:${n + 1}`;
            if (ALLOWED[id]) continue;
            offenders.push(`${id}  >${value}<`);
          }
        }
      }
    }
    expect(offenders, 'Spanish literals left in the UI:\n' + offenders.join('\n')).toEqual([]);
  });
});
