/**
 * Optional host permissions (audit blocker #1 for the Web Store).
 *
 * The manifest used to declare ~96 host_permissions, which Chrome Web Store
 * review reads as "collects your browsing habits". They moved to
 * `optional_host_permissions` and are granted inside a user gesture, at the
 * moment a participant actually enables the provider that needs them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { missingHosts, hasHosts, permissionsApiAvailable } from '../../src/shared/host-permissions';
import {
  PROVIDER_HOSTS,
  providerHosts,
  hostsForProviders,
  allProviderHosts,
} from '../../src/shared/provider-hosts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('missingHosts', () => {
  it('reports nothing when the origins are granted', async () => {
    vi.stubGlobal('chrome', {
      permissions: { getAll: async () => ({ origins: ['https://api.deepl.com/*'] }) },
      contains: async () => true,
    });
    expect(await missingHosts(['https://api.deepl.com/*'])).toEqual([]);
    expect(await hasHosts(['https://api.deepl.com/*'])).toBe(true);
  });

  it('reports the ungranted origins', async () => {
    vi.stubGlobal('chrome', {
      permissions: { getAll: async () => ({ origins: ['https://api.deepl.com/*'] }) },
      contains: async () => false,
    });
    expect(await missingHosts(['https://api.deepl.com/*', 'https://api.openai.com/*'])).toEqual([
      'https://api.openai.com/*',
    ]);
    expect(await hasHosts(['https://api.deepl.com/*', 'https://api.openai.com/*'])).toBe(false);
  });

  it('treats a wildcard grant as covering the origin', async () => {
    vi.stubGlobal('chrome', {
      permissions: {
        getAll: async () => ({ origins: ['https://forvo.com/*', 'https://*.forvo.com/*'] }),
        contains: async () => true,
      },
    });
    // `*.forvo.com` covers the audio CDN subdomain but not the apex…
    expect(await missingHosts(['https://audio12.forvo.com/*'])).toEqual([]);
    expect(await missingHosts(['https://forvo.com/*'])).toEqual([]);
    // …and it does not reach someone else's host.
    expect(await missingHosts(['https://api.openai.com/*'])).toEqual(['https://api.openai.com/*']);
  });

  it('is a no-op outside an extension context (vitest)', async () => {
    vi.stubGlobal('chrome', undefined);
    // With no permissions API there is nothing that CAN be granted, so a
    // request must not be blocked on a listing that will never appear.
    expect(permissionsApiAvailable()).toBe(false);
    expect(await missingHosts(['https://anything.example/*'])).toEqual([]);
    expect(await hasHosts(['https://anything.example/*'])).toBe(true);
  });
});

describe('match pattern semantics', () => {
  const covered = async (origin: string, grant: string): Promise<boolean> => {
    vi.stubGlobal('chrome', {
      permissions: { getAll: async () => ({ origins: [grant] }), contains: async () => true },
      storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
    });
    try {
      return (await missingHosts([origin])).length === 0;
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it('a ported pattern only covers its own port', async () => {
    expect(await covered('http://localhost:8765/*', 'http://localhost:8765/*')).toBe(true);
    expect(await covered('http://localhost:9999/*', 'http://localhost:8765/*')).toBe(false);
  });

  it('a portless pattern still covers any port (Chrome drops the port)', async () => {
    expect(await covered('http://localhost:8765/*', 'http://localhost/*')).toBe(true);
    expect(await covered('http://127.0.0.1:8765/*', 'http://127.0.0.1/*')).toBe(true);
  });

  it('an IPv6 literal keeps its shape and compares its port', async () => {
    expect(await covered('http://[::1]:8765/*', 'http://[::1]:8765/*')).toBe(true);
    // The bug this pins: the host was rewritten BEFORE the port was read, so
    // `[::1]:9999` matched a `[::1]:8765` grant on an empty port.
    expect(await covered('http://[::1]:9999/*', 'http://[::1]:8765/*')).toBe(false);
    expect(await covered('http://[::1]/*', 'http://[::1]/*')).toBe(true);
  });

  it('a port on the origin alone does not defeat a portless pattern', async () => {
    expect(await covered('https://api.deepl.com:443/*', 'https://api.deepl.com/*')).toBe(true);
  });

  it('a ported pattern covers the origin written with that scheme default', async () => {
    // `https://api.deepl.com` IS `https://api.deepl.com:443` for Chrome: the
    // two must compare equal once both sides carry their default.
    expect(await covered('https://api.deepl.com/*', 'https://api.deepl.com:443/*')).toBe(true);
    expect(await covered('https://api.deepl.com:443/*', 'https://api.deepl.com:443/*')).toBe(true);
    // …and a NON-default port is still refused.
    expect(await covered('https://api.deepl.com/*', 'https://api.deepl.com:8443/*')).toBe(false);
  });

  it('the wildcard host covers everything, paths included', async () => {
    expect(await covered('https://any.example/deep/path', '*://*/*')).toBe(true);
  });

  it('a subdomain pattern covers the apex and the children, not siblings', async () => {
    expect(await covered('https://dictionary.cambridge.org/*', 'https://*.dictionary.cambridge.org/*')).toBe(true);
    expect(await covered('https://es.dictionary.cambridge.org/*', 'https://*.dictionary.cambridge.org/*')).toBe(true);
    expect(await covered('https://cambridge.org/*', 'https://*.dictionary.cambridge.org/*')).toBe(false);
  });

  it('path wildcards span the whole path', async () => {
    expect(await covered('https://api.example.com/v2/things/1', 'https://api.example.com/*')).toBe(true);
    expect(await covered('https://api.example.com/v1', 'https://api.example.com/v2/*')).toBe(false);
  });
});

describe('provider host table', () => {
  it('covers every provider the UI can select', () => {
    for (const id of [
      'translate:deepl', 'translate:google', 'translate:mymemory',
      'translate:lingva', 'translate:libretranslate',
      'ai:openai', 'ai:anthropic', 'ai:google-ai',
      'tts:google', 'tts:elevenlabs',
      'vip:unsplash', 'vip:pixabay', 'dict:cambridge', 'packs:cdn',
    ]) {
      expect(providerHosts(id), id).not.toEqual([]);
    }
  });

  it('returns nothing for an unknown provider instead of throwing', () => {
    expect(providerHosts('nope')).toEqual([]);
  });

  it('unions the hosts of a provider set without duplicates', () => {
    const both = hostsForProviders(['ai:openai', 'ai:anthropic']);
    expect(both).toContain('https://api.openai.com/*');
    expect(both).toContain('https://api.anthropic.com/*');
    expect(new Set(both).size).toBe(both.length);
    // The ElevenLabs origin is shared by the TTS and AI entries.
    const shared = hostsForProviders(['tts:elevenlabs', 'ai:elevenlabs']);
    expect(new Set(shared).size).toBe(1);
  });

  it('has no duplicate origins across the whole table', () => {
    const all = allProviderHosts();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(50);
  });

  it('every entry is a chrome match pattern', () => {
    // `chrome.permissions` rejects anything else, so this guards typos.
    const pattern = /^(https?|\*):\/\/(\*|\*\.[^/]+|[^/*]+)\/.*$/;
    for (const [provider, hosts] of Object.entries(PROVIDER_HOSTS)) {
      for (const host of hosts) {
        expect(pattern.test(host), `${provider}: ${host}`).toBe(true);
      }
    }
  });
});
