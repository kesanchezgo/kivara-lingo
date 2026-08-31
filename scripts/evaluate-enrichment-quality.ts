import { readFileSync } from 'node:fs';

interface ProbeRow {
  kind: string;
  requestedToken: string;
  tier: 'standard' | 'vip';
  bilingual?: string;
}

interface ProbeReport {
  generatedAt: string;
  rows: ProbeRow[];
}

const DEFAULT_REPORT = 'docs/reports/final-quality/enrichment-hover-coverage-probe-2026-08-12.json';

const EXPECTED_PRIMARY: Record<string, string[]> = {
  apple: ['manzana'],
  freedom: ['libertad'],
  run: ['correr'],
  wonderful: ['maravilloso', 'estupendo', 'fantástico', 'extraordinario'],
  quickly: ['rápidamente', 'deprisa', 'rápido'],
  anything: ['algo', 'cualquier cosa'],
  each: ['cada'],
  despite: ['a pesar de', 'pese a'],
  nevertheless: ['sin embargo', 'no obstante'],
  "don't": ['no'],
  'well-known': ['conocido', 'famoso'],
  tensor: ['tensor'],
  lit: ['genial'],
  'look up': ['buscar'],
  'kick the bucket': ['estirar la pata', 'morirse', 'palmarla'],
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function glosses(row: ProbeRow): string[] {
  return (row.bilingual ?? '')
    .split('·')
    .map((value) => value.trim())
    .filter(Boolean);
}

function expectedRank(row: ProbeRow): number | null {
  const expected = EXPECTED_PRIMARY[row.requestedToken]?.map(normalize);
  if (!expected) return null;
  const rank = glosses(row).findIndex((value) => expected.includes(normalize(value)));
  return rank === -1 ? null : rank + 1;
}

function suspiciousGloss(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length > 4 ||
    /^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñüÜ-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñüÜ-]+)+$/.test(value) ||
    /\b(?:cada día|cada año|por semana|por mes)\b/i.test(value);
}

const reportPath = process.argv[2] ?? DEFAULT_REPORT;
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ProbeReport;
const evaluated = report.rows
  .filter((row) => EXPECTED_PRIMARY[row.requestedToken])
  .map((row) => {
    const values = glosses(row);
    const rank = expectedRank(row);
    return {
      token: row.requestedToken,
      kind: row.kind,
      tier: row.tier,
      expected: EXPECTED_PRIMARY[row.requestedToken],
      expectedRank: rank,
      primaryCorrect: rank === 1,
      suspiciousVariants: values.filter(suspiciousGloss),
      bilingual: row.bilingual ?? '',
    };
  });

const byToken = new Map<string, typeof evaluated>();
for (const row of evaluated) {
  const tokenRows = byToken.get(row.token) ?? [];
  tokenRows.push(row);
  byToken.set(row.token, tokenRows);
}

const vipRegressions = Array.from(byToken.entries()).flatMap(([token, rows]) => {
  const standard = rows.find((row: typeof evaluated[number]) => row.tier === 'standard');
  const vip = rows.find((row: typeof evaluated[number]) => row.tier === 'vip');
  if (!standard?.primaryCorrect || vip?.primaryCorrect) return [];
  return [{ token, standard: standard.bilingual, vip: vip?.bilingual ?? '' }];
});

const summary = {
  sourceReport: reportPath,
  sourceGeneratedAt: report.generatedAt,
  evaluatedRows: evaluated.length,
  primaryCorrect: evaluated.filter((row) => row.primaryCorrect).length,
  expectedMissing: evaluated.filter((row) => row.expectedRank === null).length,
  suspiciousVariantCount: evaluated.reduce((sum, row) => sum + row.suspiciousVariants.length, 0),
  vipRegressions,
};

console.log(JSON.stringify({ summary, rows: evaluated }, null, 2));
if (vipRegressions.length > 0) process.exitCode = 1;
