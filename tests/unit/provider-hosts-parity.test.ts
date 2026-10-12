/**
 * Parity between the hosts PROVIDER_HOSTS asks for and what the manifest
 * actually grants.
 *
 * `permissions.request` REJECTS the entire call when the origin it is
 * asked to cover is not on the `optional_host_permissions` list — a
 * provider with a half-covered group silently never grants, which is the
 * failure the review flagged for `lingva.ml` (the manifest had three
 * lingva instances but not the one the UI offered).
 *
 * This test walks both files and fails per missing origin, so adding a
 * provider host without the manifest (or the reverse) is a test failure
 * rather than a UI button that does nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const root = process.cwd();

const readJson = (p: string) => JSON.parse(readFileSync(`${root}/${p}`, 'utf8')) as Record<string, string[]>;
const readText = (p: string) => readFileSync(`${root}/${p}`, 'utf8');

function hostsFromProviderHosts(): string[] {
  const src = readText('src/shared/provider-hosts.ts');
  // Every `'https://...'` literal in the file, whatever nesting.
  return [...src.matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]);
}

function hostsFromManifest(): string[] {
  const manifest = readJson('manifest.json');
  return manifest.optional_host_permissions ?? [];
}

describe('PROVIDER_HOSTS vs manifest optional_host_permissions', () => {
  it('every origin the UI offers is on the grant list', () => {
    const providers = hostsFromProviderHosts();
    const granted = new Set(hostsFromManifest());
    const missing = providers.filter((p) => !granted.has(p));
    // No origin may be silently ungranted: that is what makes the "Grant"
    // button in the UI reject the whole request and the toggle stay dead.
    expect(missing, `providers ask for these origins with no manifest entry: ${missing.join(', ')}`).toEqual([]);
  });
});
