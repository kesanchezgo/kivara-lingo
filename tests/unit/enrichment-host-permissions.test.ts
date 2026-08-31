import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  host_permissions: string[];
};

function allowsHost(host: string): boolean {
  return manifest.host_permissions.some((pattern) => {
    const match = /^(?:\*|https?):\/\/([^/]+)/.exec(pattern);
    if (!match) return false;
    const permitted = match[1].toLowerCase();
    if (permitted === '*') return true;
    if (permitted.startsWith('*.')) {
      const rootDomain = permitted.slice(2);
      return host === rootDomain || host.endsWith(`.${rootDomain}`);
    }
    return host === permitted;
  });
}

describe('enrichment host permissions', () => {
  it('grants every literal HTTPS host used by an enrichment source', () => {
    const sourcesDir = join(root, 'src/background/enrichment/sources');
    const missing = new Map<string, string[]>();

    for (const file of readdirSync(sourcesDir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(sourcesDir, file), 'utf8');
      const hosts = [...source.matchAll(/https:\/\/([a-z0-9.-]+)/gi)]
        .map((match) => match[1].toLowerCase());
      for (const host of new Set(hosts)) {
        if (!allowsHost(host)) {
          const files = missing.get(host) ?? [];
          files.push(file);
          missing.set(host, files);
        }
      }
    }

    expect(Object.fromEntries(missing)).toEqual({});
  });
});
