/**
 * Optional host permissions (audit blocker #1 for the Web Store).
 *
 * The manifest used to declare ~96 host_permissions, which Chrome Web Store
 * review reads as "collects your browsing habits". They moved to
 * `optional_host_permissions` and are granted inside a user gesture, at the
 * moment a participant actually enables the provider that needs them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { missingHosts, hasHosts } from '../../src/shared/host-permissions';
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
    console.log('DBG missing=', JSON.stringify(await missingHosts(['https://api.deepl.com/*', 'https://api.openai.com/*'])), 'has=', await hasHosts(['https://api.openai.com/*']));
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
    expect(await missingHosts(['https://anything.example/*'])).toEqual([]);
    expect(await hasHosts(['https://anything.example/*'])).toBe(true);
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
