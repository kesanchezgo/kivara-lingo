/**
 * SettingsTab remains the stateful orchestrator after its UI pieces move.
 * This guard prevents the monolith from silently regrowing and pins the
 * module paths used by the real root render.
 *
 * F9 removed the `app/components/tabs/settings-primitives` re-export shim:
 * the claim changed from "the old path forwards to src/ui" to "every tab
 * imports src/ui/primitives directly and the shim is gone".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const tabsDir = path.join(process.cwd(), 'src/app/components/tabs');
const read = (file: string) => readFileSync(path.join(tabsDir, file), 'utf8');

const root = read('SettingsTab.tsx');
const primitives = readFileSync(path.join(process.cwd(), 'src/ui/primitives/settings-primitives.tsx'), 'utf8');
const ai = read('AiByokSection.tsx');

/** Every tab module that renders the shared primitives. */
const TAB_MODULES = ['SettingsTab.tsx', 'SubtitlesTab.tsx', 'VipSection.tsx', 'VocabTab.tsx', 'AiByokSection.tsx', 'RecentCards.tsx'];

describe('SettingsTab module boundaries', () => {
  it('keeps the root focused on orchestration', () => {
    expect(root).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/ui\/primitives\/settings-primitives['"]/);
    expect(root).toMatch(/from ['"]\.\/AiByokSection['"]/);
    expect(root).not.toMatch(/function (Accordion|AiByokSection)\b/);
    expect(root).not.toMatch(/type AiTestStatus\b/);
  });

  it('has no re-export shim left and the tabs import src/ui directly', () => {
    expect(existsSync(path.join(tabsDir, 'settings-primitives.tsx'))).toBe(false);
    for (const file of TAB_MODULES) {
      expect(read(file), `${file} still imports the retired shim`).not.toMatch(/from ['"]\.\/settings-primitives['"]/);
    }
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