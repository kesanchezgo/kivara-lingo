/**
 * Trimmed icon generator.
 *
 * The icon layer used to import every Phosphor component from
 * `@phosphor-icons/react`, and each component carries all six weights — 289 KB
 * minified for the 95 exported names, of which a fraction is ever rendered
 * (docs/REDESIGN-V2.md §3 H7 measured 286 KB for the prototype layer).
 *
 * This script scans `src/**` for imports from `ui/icons`, records which
 * weights each icon is actually rendered with (`weight`, `fill`,
 * `strokeWidth`, plus the regular default), pulls exactly those SVG paths out
 * of `@phosphor-icons/react`'s per-icon `defs` modules, and writes
 * `src/ui/icons.generated.tsx`.
 *
 * The public API stays `src/ui/icons.tsx` (a barrel); the runtime wrapper and
 * the weight mapping stay hand-written in `src/ui/icon-base.tsx`; the
 * lucide→Phosphor name map stays hand-written in `src/ui/icon-map.ts`.
 *
 * Usage:
 *   node scripts/build-icons.mjs           # write the file
 *   node scripts/build-icons.mjs --check   # exit 1 if the file is stale
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
export const GENERATED_PATH = path.join(SRC_DIR, 'ui', 'icons.generated.tsx');
const MAP_PATH = path.join(SRC_DIR, 'ui', 'icon-map.ts');

/** Files that define the icon layer itself, never consumers to scan. */
const SELF_FILES = new Set([
  path.join(SRC_DIR, 'ui', 'icons.tsx'),
  path.join(SRC_DIR, 'ui', 'icons.generated.tsx'),
  path.join(SRC_DIR, 'ui', 'icon-base.tsx'),
  path.join(SRC_DIR, 'ui', 'icon-map.ts'),
]);

/** Fixed order, so the generated file is byte-stable across runs. */
const WEIGHT_ORDER = ['regular', 'bold', 'light', 'fill', 'thin', 'duotone'];
const KNOWN_WEIGHTS = new Set(WEIGHT_ORDER);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else if (/\.tsx?$/.test(entry.name) && !SELF_FILES.has(abs)) {
      out.push(abs);
    }
  }
  return out;
}

/** Parse the hand-written lucide→Phosphor map without importing TypeScript. */
function readIconMap() {
  const text = readFileSync(MAP_PATH, 'utf8');
  const body = text.match(/export const ICON_MAP = \{([\s\S]*?)\} as const;/);
  if (!body) throw new Error(`${MAP_PATH}: ICON_MAP object not found`);
  const map = new Map();
  for (const line of body[1].split('\n')) {
    const m = line.match(/^\s*(\w+):\s*'(\w+)',?\s*$/);
    if (m) map.set(m[1], m[2]);
  }
  if (map.size === 0) throw new Error(`${MAP_PATH}: ICON_MAP is empty`);
  return map;
}

function parseImportSpecifiers(list) {
  const out = [];
  for (const raw of list.split(',')) {
    const spec = raw.trim();
    if (!spec || /^type\s/.test(spec)) continue;
    const alias = spec.match(/^(\w+)\s+as\s+(\w+)$/);
    out.push(alias ? { name: alias[1], local: alias[2] } : { name: spec, local: spec });
  }
  return out;
}

function weightForStroke(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n >= 2.5) return 'bold';
  if (n <= 1.75) return 'light';
  return 'regular';
}

/** Weights implied by one JSX opening tag's attribute text. */
function weightsFromAttributes(attrs) {
  const found = [];
  const weight = attrs.match(/\bweight\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/);
  if (weight) {
    if (weight[1] || weight[2]) {
      found.push(weight[1] || weight[2]);
    } else if (weight[3]) {
      for (const literal of weight[3].matchAll(/'([a-z]+)'|"([a-z]+)"/g)) {
        found.push(literal[1] || literal[2]);
      }
    }
  }
  const fill = attrs.match(
    /\bfill\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"]([^'"]*)['"]\s*\})/,
  );
  const fillValue = fill && (fill[1] || fill[2] || fill[3]);
  if (fillValue && fillValue !== 'none') found.push('fill');

  const stroke = attrs.match(
    /\bstrokeWidth\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/,
  );
  if (stroke) {
    const mapped = weightForStroke(stroke[1] || stroke[2] || stroke[3]);
    if (mapped) found.push(mapped);
  }
  return found.filter((w) => KNOWN_WEIGHTS.has(w));
}

/**
 * Every icon imported anywhere in `src` and the weights it is rendered with.
 * The regular weight is always included: `strokeWidth` absent or 2 maps to it.
 */
export function scanIconUsage() {
  const iconMap = readIconMap();
  const files = walk(SRC_DIR);
  const icons = new Map(); // name → Set<weight>
  const unknown = new Set();

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](?:[^'"]*\/)?icons['"]/g;
    let imports;
    const localEntries = [];
    while ((imports = importRe.exec(text)) !== null) {
      for (const { name, local } of parseImportSpecifiers(imports[1])) {
        if (!iconMap.has(name)) {
          unknown.add(`${path.relative(REPO_ROOT, file)}: ${name}`);
          continue;
        }
        if (!icons.has(name)) icons.set(name, new Set(['regular']));
        localEntries.push({ name, local });
        // Match this file's local tag: aliases are per-file.
        const tagRe = new RegExp(`<\\s*${local}\\b([^>]*?)\\/?>`, 'g');
        let tag;
        while ((tag = tagRe.exec(text)) !== null) {
          for (const weight of weightsFromAttributes(tag[1])) icons.get(name).add(weight);
        }
      }
    }

    // Components held in a value and rendered through a member expression:
    // `const tabs = [{ icon: Settings }]; <tab.icon weight={...} />`. The tag
    // name is not the icon name, so the per-name scan above cannot see it.
    // Collect the names assigned to `icon:` and apply the weights of every
    // member-expression tag in this file to those names.
    const dynamicNames = new Set(
      [...text.matchAll(/\bicon:\s*(\w+)/g)].map((match) => match[1]),
    );
    if (dynamicNames.size > 0) {
      for (const entry of localEntries) {
        if (!dynamicNames.has(entry.local)) continue;
        const dynamicTagRe = /<\s*[a-z_$][\w$]*\.[\w$]+\b([^>]*?)\/?>/g;
        let dynamicTag;
        while ((dynamicTag = dynamicTagRe.exec(text)) !== null) {
          for (const weight of weightsFromAttributes(dynamicTag[1])) {
            icons.get(entry.name).add(weight);
          }
        }
      }
    }
  }

  if (unknown.size > 0) {
    throw new Error(
      `ui/icons names missing from src/ui/icon-map.ts:\n  ${[...unknown].join('\n  ')}`,
    );
  }

  return {
    icons,
    imported: new Set(icons.keys()),
    scannedFiles: files.length,
  };
}

/**
 * Flatten the React element tree Phosphor stores per weight into `{d, opacity}`
 * records. Its defs modules create only fragments and `<path>` elements.
 */
function flattenNodes(element, out = []) {
  if (!element || typeof element !== 'object') return out;
  if (Array.isArray(element)) {
    for (const child of element) flattenNodes(child, out);
    return out;
  }
  if (typeof element.type === 'string') {
    if (element.type !== 'path') {
      throw new Error(`unexpected Phosphor SVG node <${element.type}>`);
    }
    const node = { d: element.props.d };
    if (element.props.opacity !== undefined) node.opacity = String(element.props.opacity);
    out.push(node);
    return out;
  }
  flattenNodes(element.props ? element.props.children : undefined, out);
  return out;
}

async function loadIconWeights(phosphorName) {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@phosphor-icons/react/package.json');
  const defsFile = path.join(
    path.dirname(pkgPath),
    'dist',
    'defs',
    `${phosphorName}.es.js`,
  );
  let mod;
  try {
    mod = await import(pathToFileURL(defsFile).href);
  } catch (error) {
    throw new Error(`cannot load @phosphor-icons/react defs for ${phosphorName}: ${error}`);
  }
  return mod.default;
}

function quote(value) {
  if (!/^[0-9A-Za-z.,\- ]+$/.test(value)) return JSON.stringify(value);
  return `'${value}'`;
}

function formatWeight(weight, nodes) {
  const lines = nodes.map((node) => {
    const opacity = node.opacity ? `, opacity: ${quote(node.opacity)}` : '';
    return `    { d: ${quote(node.d)}${opacity} },`;
  });
  return `  ${weight}: [\n${lines.join('\n')}\n  ],`;
}

/** Build the generated module's contents in memory (the drift test uses this). */
export async function generateIcons() {
  const { icons, imported, scannedFiles } = scanIconUsage();
  const iconMap = readIconMap();
  const names = [...icons.keys()].sort((a, b) => a.localeCompare(b));
  const blocks = [];
  const variants = [];

  for (const name of names) {
    const weights = WEIGHT_ORDER.filter((w) => icons.get(name).has(w));
    const defs = await loadIconWeights(iconMap.get(name));
    const rendered = [];
    for (const weight of weights) {
      const element = defs.get(weight);
      if (!element) {
        throw new Error(`@phosphor-icons/react ${iconMap.get(name)} has no "${weight}" weight`);
      }
      const nodes = flattenNodes(element);
      if (nodes.length === 0 || nodes.some((n) => typeof n.d !== 'string')) {
        throw new Error(`@phosphor-icons/react ${iconMap.get(name)} "${weight}" has no path data`);
      }
      variants.push(`${name}.${weight}`);
      rendered.push(formatWeight(weight, nodes));
    }
    blocks.push(
      `export const ${name} = /*#__PURE__*/ wrap({\n${rendered.join('\n')}\n}, '${name}');`,
    );
  }

  const content = `/**
 * AUTO-GENERATED by scripts/build-icons.mjs — do not edit.
 *
 * Contains only the (icon, weight) combinations imported anywhere in src/.
 * Add an icon import, add its lucide→Phosphor pair to icon-map.ts, then run
 * \`pnpm icons:build\`.
 */
import { wrap } from './icon-base';

${blocks.join('\n\n')}
`;

  return {
    content,
    names,
    importedNames: [...imported].sort((a, b) => a.localeCompare(b)),
    variants,
    scannedFiles,
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const result = await generateIcons();
  const current = (() => {
    try {
      return readFileSync(GENERATED_PATH, 'utf8');
    } catch {
      return null;
    }
  })();

  if (check) {
    if (current !== result.content) {
      console.error(
        `${path.relative(REPO_ROOT, GENERATED_PATH)} is stale — run "pnpm icons:build".`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `icons up to date: ${result.names.length} icons · ${result.variants.length} variants`,
    );
    return;
  }

  writeFileSync(GENERATED_PATH, result.content, 'utf8');
  console.log(
    `icons: ${result.names.length} icons · ${result.variants.length} variants · ` +
      `${Buffer.byteLength(result.content)} bytes in ${path.relative(REPO_ROOT, GENERATED_PATH)}`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
