#!/usr/bin/env node
/**
 * Line-ending hygiene, checked where it is actually stored: the committed blob.
 *
 * `.editorconfig` has said `end_of_line = lf` and `insert_final_newline = true`
 * since it was written, and the missing-final-newline defect kept landing in
 * `src/popup/main.tsx`, `src/options/main.tsx` and their two `index.html`
 * neighbours — the same four files, repeatedly, because nothing enforced it.
 *
 * Deliberately checks the INDEX, not the working tree. This is a Windows
 * checkout with `core.autocrlf`, so every file on disk is CRLF and a
 * working-tree scan reports hundreds of false problems across the whole repo.
 * Git normalises on commit and stores LF; the blob is the convention that
 * matters, and `git ls-files --eol` is the cheapest way to read it.
 *
 * Run it in CI (.github/workflows/ci.yml) and locally:
 *   node scripts/check-line-endings.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = process.cwd();

const SKIP = /(^|\/)(node_modules|dist|test-results|coverage)\//;

/**
 * Generated corpora, out of scope.
 *
 *  - `src/assets/**` comes from `npm run dict:build` / the wordnet and MWE
 *    converters: their writers decide the trailing byte, and the convention
 *    being enforced here is about files a person edits. Touching 34
 *    multi-megabyte blobs to append one byte would swamp every future diff
 *    for no user value.
 *  - `docs/reports/**` is the audit and probe output (the corpus tools write
 *    it, nobody hand-edits it) — same reasoning. They are also ~11 MB of
 *    history; re-stamping byte one of every file would be pure diff noise.
 *
 * If the generators ever bother to emit it, this list gets shorter.
 */
const GENERATED = /^(src\/assets\/|docs\/reports\/)/;

/**
 * Read `git ls-files -s`: `mode sha stage\t<path>`, filtered to tracked text
 * files. The `-text` marker comes from `--eol`, which we cannot mix into
 * `-s`, so the two listings are joined on path.
 */
const staged = execFileSync('git', ['ls-files', '-s'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const eol = execFileSync('git', ['ls-files', '--eol'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

/** path → true when Git stores it as binary (no line-ending convention). */
const binary = new Set();
for (const line of eol.split('\n')) {
  const m = /^i\/([-\w]+)\s+w\/([-\w]+)\s+attr\/(\S*)\s+(.*)$/.exec(line);
  if (!m) continue;
  // `attr/-text` is the attribute, NOT a reliable binary marker: without a
  // `.gitattributes` in the tree git decides binary-ness by sniffing the
  // BLOB and reports plain binaries as `i/-text` with an EMPTY attr column.
  // Trusting that column alone would grade a versioned PNG (outside
  // src/assets, where nothing forces the attribute) as "no final newline".
  if (m[3].includes('-text') || m[1] === '-text') binary.add(m[4]);
}

/**
 * Byte-sniff fallback, done in the same batch pass below: a blob whose first
 * 8000 bytes contain a NUL is binary, whatever the attribute column said.
 * That is git's own heuristic and covers every case `attr/` misses.
 */
const NUL_WINDOW = 8000;

function looksBinary(bytes) {
  const n = Math.min(bytes.length, NUL_WINDOW);
  for (let i = 0; i < n; i += 1) if (bytes[i] === 0) return true;
  return false;
}

/** Shas for the text files we care about, in `git cat-file --batch` order. */
const blobs = [];
for (const line of staged.split('\n')) {
  const m = /^(\d+) ([0-9a-f]+) \d\t(.*)$/.exec(line);
  if (!m) continue;
  const path = m[3];
  if (SKIP.test(path) || GENERATED.test(path) || binary.has(path)) continue;
  blobs.push({ sha: m[2], path });
}

/**
 * Read every blob in ONE `git cat-file --batch`.
 *
 * This is the point of the whole rewrite: `git ls-files --eol` reports `i/lf`
 * for a multi-line file that is missing its FINAL newline — the byte is simply
 * not part of any line ending, so the eol column says nothing about it. The
 * old version of this script therefore could not see the very defect it was
 * written for. Reading the stored blob and checking its LAST byte is what
 * actually detects it, and the same pass catches a stored CRLF (`\r\n`) that
 * `autocrlf` would otherwise normalise silently on stage.
 */
const batch = spawnSync('git', ['cat-file', '--batch'], {
  cwd: ROOT,
  input: Buffer.from(blobs.map((b) => b.sha).join('\n') + '\n', 'utf8'),
  maxBuffer: 1024 * 1024 * 1024,
});

const offenders = [];
let cursor = 0;
const out = batch.stdout;
/** Byte offsets must be read in latin1 so each byte is one character. */
const text = out.toString('latin1');
for (let i = 0; i < blobs.length; i += 1) {
  const { sha, path } = blobs[i];
  const headerEnd = text.indexOf('\n', cursor);
  if (headerEnd === -1) break;
  const header = text.slice(cursor, headerEnd);
  const [, size] = / (\d+)\n?$/.exec(header) ?? [];
  if (size === undefined) {
    cursor = headerEnd + 1;
    continue; // missing blob — reported by git itself
  }
  const start = headerEnd + 1;
  const bytes = out.subarray(start, start + Number(size));
  cursor = start + Number(size) + 1; // trailing LF after the payload
  if (bytes.length === 0) continue;
  // The NUL sniff runs here, not on the index: an empty binary (0 bytes) is
  // skipped above, and a text file never contains a NUL in its first 8 KB.
  if (looksBinary(bytes)) continue;
  const lastByte = bytes[bytes.length - 1];
  if (lastByte !== 0x0a) {
    offenders.push(`${path}: no final newline`);
  } else if (bytes.includes(0x0d)) {
    offenders.push(`${path}: stored CR (CRLF) inside an LF blob`);
  }
}

if (offenders.length) {
  console.error(
    `line-endings: ${offenders.length} problem(s) in the committed blobs. ` +
      '.editorconfig governs these files: end_of_line = lf, insert_final_newline = true.\n',
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}

console.log(`line-endings: ${blobs.length} tracked text files clean (LF, one final newline).`);
