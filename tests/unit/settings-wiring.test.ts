/**
 * SettingsTab remains the stateful orchestrator after its UI pieces move.
 * This guard prevents the monolith from silently regrowing and pins the
 * module paths used by the real root render.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = readFileSync(path.join(process.cwd(), 'src/app/components/tabs/SettingsTab.tsx'), 'utf8');
const primitives = readFileSync(path.join(process.cwd(), 'src/app/components/tabs/settings-primitives.tsx'), 'utf8');
const ai = readFileSync(path.join(process.cwd(), 'src/app/components/tabs/AiByokSection.tsx'), 'utf8');

describe('SettingsTab module boundaries', () => {
  it('keeps the root focused on orchestration', () => {
    expect(root).toMatch(/from ['"]\.\/settings-primitives['"]/);
    expect(root).toMatch(/from ['"]\.\/AiByokSection['"]/);
    expect(root).not.toMatch(/function (Accordion|AiByokSection)\b/);
    expect(root).not.toMatch(/type AiTestStatus\b/);
  });

  it('exports the moved controls and helpers', () => {
    expect(primitives).toMatch(/export function Accordion\b/);
    expect(primitives).toMatch(/export function Toggle\b/);
    expect(primitives).toMatch(/export function SegmentedControl\b/);
    expect(ai).toMatch(/export function AiByokSection\b/);
  });

  it('ships nothing of the retired ASR pipeline', () => {
    // On-device ASR (issue #30) was removed rather than left behind a flag: the
    // glue could never load under MV3's CSP and the section could only ever
    // render a reason. A re-import from anywhere here would mean it came back.
    for (const [name, text] of [
      ['root', root],
      ['primitives', primitives],
      ['ai', ai],
    ] as const) {
      expect(text, `${name} still references the retired ASR module`).not.toMatch(/whisper/i);
      expect(text, `${name} still references an asr slice`).not.toMatch(/\basr\b/i);
    }
  });
});
