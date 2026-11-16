// Build the open-root copy of dist the QA rows run against.
//
//   node qa/netflix/make-dist-open.mjs
//
// Copies the production `dist/` into <QA dir>/dist-open and patches the ONE
// `attachShadow({mode:"closed"})` occurrence to `"open"`, so the harness can
// read inside the shadow roots. Everything else is the shipped bundle.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const QA = process.env.KIVARA_QA_DIR ?? path.join(os.tmpdir(), 'kivara-qa');
const repo = path.resolve(import.meta.dirname, '..', '..');
const SRC = path.join(repo, 'dist');
const DEST = path.join(QA, 'dist-open');

if (!fs.existsSync(path.join(SRC, 'manifest.json'))) {
  console.error('no dist/manifest.json — run `pnpm build` first');
  process.exit(1);
}
fs.cpSync(SRC, DEST, { recursive: true });

let patched = 0;
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js')) continue;
    const body = fs.readFileSync(p, 'utf8');
    if (body.includes('attachShadow({mode:"closed"}')) {
      fs.writeFileSync(p, body.replace('attachShadow({mode:"closed"}', 'attachShadow({mode:"open"}'));
      patched++;
      console.log('patched', path.relative(DEST, p));
    }
  }
};
walk(DEST);
console.log(`dist-open ready (${patched} shadow root${patched === 1 ? '' : 's'} opened)`);
