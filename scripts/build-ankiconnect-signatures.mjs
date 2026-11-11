// language: JavaScript, file: scripts/build-ankiconnect-signatures.mjs, runtime: Node 20+, target: repo fixtures
//
// GENERATED FIXTURE, NOT HAND-WRITTEN.
//
// This script downloads the real AnkiConnect add-on source and derives every
// `@util.api()` action signature from it. The output at
// `tests/fixtures/ankiconnect-signatures.json` must never be edited by hand:
// re-run this script after an AnkiConnect release so the client contract test
// tracks the add-on instead of drifting from it.
//
// Usage: node scripts/build-ankiconnect-signatures.mjs
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'ankiconnect-signatures.json',
);

// The OFFICIAL package, as Anki itself downloads it: the add-on id on
// AnkiWeb (AnkiConnect is 2055492159) and the same request Anki makes in
// aqt/addons.py — `{appShared}download/{id}?v=2.1&p={version}`, where `p` is
// Anki's integer version (25.09 -> 250900) and the server validates it
// ("p: invalid digit found in string" otherwise). The response is the
// .ankiaddon zip the add-on marketplace serves, not a GitHub checkout, so
// the fixture tracks what users actually install.
const ADDON_ID = 2055492159;
const ADDON_URL = `https://ankiweb.net/shared/download/${ADDON_ID}?v=2.1&p=250900`;
const ADDON_PAGE = `https://ankiweb.net/shared/info/${ADDON_ID}`;

/** Matches `@util.api()`, `@api()`, and any dotted alias of the same shape. */
const DECORATOR_RE = /^\s*@(?:[A-Za-z_][\w.]*\.)?api\(\s*\)\s*$/;

async function downloadSource() {
  const response = await fetch(ADDON_URL, {
    headers: { 'User-Agent': 'Anki/25.09' },
    redirect: 'follow',
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Could not download add-on ${ADDON_ID}: HTTP ${response.status} ${body}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A zip starts with "PK\x03\x04"; anything else is an error page.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`Downloaded add-on ${ADDON_ID} is not a zip (first bytes: ${[...bytes.slice(0, 4)]})`);
  }
  const entries = unzipSync(bytes);
  const initPath = Object.keys(entries).find(
    (name) => name === '__init__.py' || name.endsWith('/__init__.py'),
  );
  if (!initPath) {
    throw new Error(
      `Add-on ${ADDON_ID} has no __init__.py (entries: ${Object.keys(entries).join(', ')})`,
    );
  }
  const source = new TextDecoder('utf-8').decode(entries[initPath]);
  if (!source.includes('class AnkiConnect')) {
    throw new Error(`${initPath} from add-on ${ADDON_ID} is not AnkiConnect`);
  }
  return { source, bytes, initPath, initBytes: entries[initPath] };
}

/**
 * Walk a Python signature line (and continuation lines) and return the raw
 * text inside the outer parentheses of `def name(...)`.
 */
function readSignature(lines, startIndex) {
  const first = lines[startIndex];
  const openIndex = first.indexOf('(');
  if (openIndex === -1) return { text: '', nextIndex: startIndex };

  let depth = 0;
  let quote = null;
  let text = '';
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const from = i === startIndex ? openIndex : 0;
    for (let j = from; j < line.length; j++) {
      const ch = line[j];
      if (quote) {
        if (ch === '\\') {
          text += ch;
          j++;
          if (j < line.length) text += line[j];
          continue;
        }
        if (ch === quote) quote = null;
        text += ch;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        text += ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        if (depth === 1 && ch === '(') continue;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) return { text, nextIndex: i };
      }
      text += ch;
    }
    text += ' ';
  }
  return { text, nextIndex: lines.length - 1 };
}

/** Split a parameter list on top-level commas (commas not inside brackets/quotes). */
function splitParams(raw) {
  const out = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        i++;
        if (i < raw.length) current += raw[i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Parse one parameter token into its declared name and optionality. */
function parseParam(token) {
  let depth = 0;
  let quote = null;
  let eqIndex = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === '=' && depth === 0) {
      eqIndex = i;
      break;
    }
  }
  const declaration = (eqIndex === -1 ? token : token.slice(0, eqIndex)).trim();
  const namePart = declaration.split(':')[0].trim();
  // Ignore positional markers, keyword splats and the implicit instance arg.
  if (!namePart || namePart === 'self' || namePart.startsWith('*') || namePart === '/') {
    return null;
  }
  if (!/^[A-Za-z_]\w*$/.test(namePart)) return null;
  return { name: namePart, optional: eqIndex !== -1 };
}

/** Extract every `@util.api()` action from the add-on source. */
function parseActions(source) {
  const lines = source.split(/\r?\n/);
  const actions = {};
  for (let i = 0; i < lines.length; i++) {
    if (!DECORATOR_RE.test(lines[i])) continue;

    let defIndex = i + 1;
    while (defIndex < lines.length) {
      const line = lines[defIndex];
      if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
        defIndex++;
        continue;
      }
      if (DECORATOR_RE.test(line)) {
        defIndex++;
        continue;
      }
      break;
    }
    if (defIndex >= lines.length) continue;
    const defMatch = /^\s*def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[defIndex]);
    if (!defMatch) continue;

    const actionName = defMatch[1];
    const { text } = readSignature(lines, defIndex);
    const params = [];
    const optional = [];
    for (const token of splitParams(text)) {
      const parsed = parseParam(token);
      if (!parsed) continue;
      params.push(parsed.name);
      if (parsed.optional) optional.push(parsed.name);
    }
    const entry = { params };
    if (optional.length > 0) entry.optional = optional;
    actions[actionName] = entry;
  }
  return actions;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function main() {
  const { source, bytes, initPath, initBytes } = await downloadSource();
  const actions = parseActions(source);
  const actionNames = Object.keys(actions).sort();
  if (actionNames.length === 0) {
    throw new Error('Parsed zero actions from the official package; refusing to write a stub fixture.');
  }

  const sortedActions = {};
  for (const name of actionNames) sortedActions[name] = actions[name];

  const fixture = {
    _meta: {
      source: ADDON_PAGE,
      downloadUrl: ADDON_URL,
      addonId: ADDON_ID,
      packageSha256: sha256(bytes),
      packageBytes: bytes.length,
      initPath,
      initSha256: sha256(initBytes),
      fetchedAt: new Date().toISOString(),
      note: 'Generated by scripts/build-ankiconnect-signatures.mjs from the official AnkiWeb package (add-on 2055492159). Do not edit by hand; re-run the script after an AnkiConnect release.',
    },
    actions: sortedActions,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

  const examples = actionNames.slice(0, 8).join(', ');
  console.log(`source:  ${ADDON_PAGE}`);
  console.log(`package: ${fixture._meta.packageSha256} (${bytes.length} B)`);
  console.log(`init:    ${fixture._meta.initSha256} (${initPath})`);
  console.log(`actions: ${actionNames.length}`);
  console.log(`examples: ${examples}`);
  console.log(`wrote:   ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
