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

import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

const SKIP = /(^|\/)(node_modules|dist|test-results|coverage)\//;

/**
 * Generated corpora, out of scope.
 *
 * `src/assets/**` comes from `npm run dict:build` / the wordnet and MWE
 * converters: their writers decide the trailing byte, and the convention being
 * enforced here is about files a person edits. Touching 34 multi-megabyte
 * blobs to append one byte would swamp every future diff for no user value.
 * If the generators ever bother to emit it, this list gets shorter.
 */
const GENERATED = /^src\/assets\//;

const out = execFileSync('git', ['ls-files', '--eol'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const offenders = [];
let checked = 0;

for (const line of out.split('\n')) {
  // `i/<eol> w/<eol> attr/<attrs> <tab> <path>`, or `i/-text` for binary.
  const match = /^i\/([-\w]+)\s+w\/([-\w]+)\s+attr\/(\S*)\s+(.*)$/.exec(line);
  if (!match) continue;
  const [, indexEol, , attrs, rel] = match;
  if (SKIP.test(rel)) continue;
  if (GENERATED.test(rel)) continue;
  if (attrs.includes('-text')) continue; // Binary: no line-ending convention.

  checked += 1;
  // The stored bytes. `i/crlf` and `i/mixed` are real violations; `i/none`
  // means the blob has no final newline, which `.editorconfig` forbids.
  if (indexEol === 'crlf' || indexEol === 'mixed') {
    offenders.push(`${rel}: stored as ${indexEol.toUpperCase()} (expected LF)`);
  } else if (indexEol === 'none') {
    offenders.push(`${rel}: no final newline`);
  }
  // `w/crlf` is normal here and NOT reported: autocrlf converts back on commit,
  // so the working tree is not where the convention lives.
}

if (offenders.length) {
  console.error(
    `line-endings: ${offenders.length} problem(s) in the committed blobs. ` +
      '.editorconfig governs these files: end_of_line = lf, insert_final_newline = true.\n',
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}

console.log(`line-endings: ${checked} tracked text files clean (LF, one final newline).`);
