/**
 * Build script — assemble the bundled MWE phrase index used by the
 * tokenizer to recognise multi-word expressions (idioms, phrasal verbs,
 * proverbs, common compounds) that aren't in the curated `en.json`.
 *
 * Source: Wiktionary category enumeration (authoritative, CC-BY-SA).
 *   - Category:English_idioms
 *   - Category:English_phrasal_verbs
 *   - Category:English_proverbs
 *
 * The output (`src/assets/mwes/en-mwe-index.json`) is a KEYS-ONLY sorted
 * array of lowercase phrases. The tokenizer loads it as a Set and only
 * needs to know "this span is an MWE"; the rich definition/translation is
 * fetched online (or from en-idioms.json) on hover.
 *
 * Run: node scripts/build-mwe-index.cjs
 *
 * Politeness: throttled to ~1 request/sec with 429 backoff so we don't
 * abuse the Wikimedia API. A full run takes a few minutes.
 */
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const UA = 'KivaraLingo/1.0 (dictionary build script; https://github.com/kivara-lingo)';
const OUT = path.join(__dirname, '..', 'src', 'assets', 'mwes', 'en-mwe-index.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetch(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, port: 443, headers: { 'User-Agent': UA, Accept: 'application/json' } },
      (res) => {
        const c = [];
        res.on('data', (x) => c.push(x));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
      },
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.end();
  });
}

async function fetchCategory(cat) {
  const members = [];
  let cmcontinue = '';
  let page = 0;
  for (;;) {
    const cont = cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : '';
    const url = `https://en.wiktionary.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:${cat}&cmlimit=500&cmtype=page&format=json${cont}`;
    let r = await fetch(url);
    let tries = 0;
    while (r.status === 429 && tries < 8) {
      const wait = 3000 * (tries + 1);
      process.stdout.write(`   429 — backoff ${wait}ms\n`);
      await sleep(wait);
      r = await fetch(url);
      tries += 1;
    }
    if (r.status !== 200) { console.log(`   ${cat} page ${page}: HTTP ${r.status}, stopping`); break; }
    let d;
    try { d = JSON.parse(r.body); } catch { break; }
    for (const m of d.query?.categorymembers || []) members.push(m.title);
    page += 1;
    if (page % 5 === 0) process.stdout.write(`   ${cat}: ${members.length} so far…\n`);
    if (d.continue && d.continue.cmcontinue) cmcontinue = d.continue.cmcontinue;
    else break;
    await sleep(1100); // ~1 req/sec — polite
  }
  return members;
}

function isGoodPhrase(title) {
  if (/[:/]/.test(title)) return false; // Appendix:/Category: pages
  if (/[^\x20-\x7E]/.test(title)) return false; // non-ASCII
  if (/\d/.test(title)) return false; // number-heavy
  const words = title.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (title !== title.toLowerCase()) return false; // drop proper nouns
  if (title.length > 40) return false;
  return true;
}

(async () => {
  const all = new Set();
  for (const cat of ['English_idioms', 'English_phrasal_verbs', 'English_proverbs']) {
    console.log(`Fetching Category:${cat}…`);
    const members = await fetchCategory(cat);
    let kept = 0;
    for (const t of members) {
      if (isGoodPhrase(t)) { all.add(t.toLowerCase()); kept += 1; }
    }
    console.log(`   ${cat}: ${members.length} raw, ${kept} kept`);
  }
  const arr = [...all].sort();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(arr));
  const raw = fs.statSync(OUT).size;
  console.log(`\nWrote ${arr.length} MWE phrases to ${OUT} (${(raw / 1024).toFixed(0)} KB)`);
  console.log('has "big girl"?', all.has('big girl'));
})();
