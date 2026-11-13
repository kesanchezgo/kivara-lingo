/**
 * Manifest host permissions and the Chrome floor (maintenance point 9).
 *
 * `http://127.0.0.1/*` and `http://localhost/*` were listed in BOTH
 * `host_permissions` (mandatory) and `optional_host_permissions` — a
 * redundant prompt for a host the extension already holds. And the manifest had
 * no `minimum_chrome_version`, so it installed on browsers too old for
 * `world: "MAIN"` content scripts (Chrome 111+) and offscreen documents
 * (109+).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'),
) as {
  host_permissions: string[];
  optional_host_permissions?: string[];
  content_scripts: Array<{ world?: string }>;
  minimum_chrome_version?: string;
};

describe('optional_host_permissions', () => {
  it('does not repeat the loopback hosts that are already mandatory', () => {
    const optional = manifest.optional_host_permissions ?? [];
    expect(optional).not.toContain('http://127.0.0.1/*');
    expect(optional).not.toContain('http://localhost/*');
    // They MUST still be mandatory: dropping them entirely would break Anki
    // and every local AI endpoint.
    expect(manifest.host_permissions).toContain('http://127.0.0.1/*');
    expect(manifest.host_permissions).toContain('http://localhost/*');
  });
});

describe('minimum_chrome_version', () => {
  it('is present and covers MAIN-world content scripts and offscreen', () => {
    const floor = Number(manifest.minimum_chrome_version);
    expect(Number.isFinite(floor), 'minimum_chrome_version must be a number').toBe(true);
    // world: "MAIN" content scripts need 111+, offscreen documents 109+.
    expect(floor).toBeGreaterThanOrEqual(111);
    expect(floor).toBeGreaterThanOrEqual(116);
  });

  it('matches the features the manifest actually uses', () => {
    const usesMainWorld = manifest.content_scripts.some((cs) => cs.world === 'MAIN');
    expect(usesMainWorld, 'the check exists because the manifest uses world: MAIN').toBe(true);
  });
});
