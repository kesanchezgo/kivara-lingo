/**
 * The manifest injects ONLY on Prime Video routes of the Amazon domains
 * (maintenance point 2), and `detectPlatform` agrees.
 *
 * Before this PR the manifest had no amazon.* entry at all (so Amazon Prime
 * users got no extension), and `detectPlatform` treated ANY amazon.com page as
 * Prime — a store page would mount the caption adapter.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPrimeRoute } from '../../src/content/platform-adapters/platform-hosts';

// Vitest runs from the repo root; the manifest lives there. (`import.meta.url`
// is an http(s) URL under the transform, so it cannot address files.)
const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'),
) as {
  content_scripts: Array<{ matches: string[]; js: string[] }>;
  host_permissions: string[];
  web_accessible_resources: Array<{ matches: string[] }>;
};

const DOMAIN = (tld: string): string =>
  tld === 'com' ? '*.amazon.com' : `*.amazon.${tld}`;

/** The regional domains the owner listed, in manifest order. */
const TLDS = ['com', 'co.uk', 'de', 'es', 'fr', 'it', 'co.jp', 'ca', 'com.mx', 'com.br', 'in'];
const ROUTES = TLDS.map((tld) => `*://${DOMAIN(tld)}/gp/video/*`);
const HOSTS = TLDS.map((tld) => `*://${DOMAIN(tld)}/*`);

describe('manifest: Prime Video on the Amazon domains', () => {
  it('injects the isolated content script on every /gp/video route', () => {
    for (const route of ROUTES) {
      const blocks = manifest.content_scripts.filter((cs) => cs.matches.includes(route));
      expect(blocks.length, `${route} in content_scripts`).toBeGreaterThanOrEqual(1);
      // The injected script on that route is the isolated content script.
      expect(blocks.some((cs) => cs.js.includes('src/content/index.tsx')), route).toBe(true);
    }
  });

  it('injects the MAIN-world interceptor on the same routes', () => {
    for (const route of ROUTES) {
      const blocks = manifest.content_scripts.filter(
        (cs) => cs.matches.includes(route) && cs.js.includes('src/content/platform-adapters/main-world-interceptor.ts'),
      );
      expect(blocks.length, `${route} MAIN-world`).toBeGreaterThanOrEqual(1);
    }
  });

  it('covers the routes in host_permissions (content scripts need them)', () => {
    for (const route of ROUTES) {
      expect(manifest.host_permissions, route).toContain(route);
    }
  });

  it('exposes the HOSTS (not the path routes) through web_accessible_resources', () => {
    // Chrome refuses a web_accessible_resources match whose path is not `/*`:
    // with `/gp/video/*` there the whole extension fails to load (verified in a
    // real browser — the service worker never registers). The resource gate is
    // host-level, like every other platform in this manifest; the PATH scoping
    // lives in content_scripts.
    for (const host of HOSTS) {
      const blocks = manifest.web_accessible_resources.filter((war) => war.matches.includes(host));
      expect(blocks.length, `${host} in web_accessible_resources`).toBeGreaterThanOrEqual(1);
    }
    for (const route of ROUTES) {
      expect(
        manifest.web_accessible_resources.some((war) => war.matches.includes(route)),
        `${route} must NOT be a WAR match`,
      ).toBe(false);
    }
  });

  it('never INJECTS on the rest of Amazon', () => {
    // The resource gate is host-level by Chrome's rule (see the test above),
    // but the CONTENT SCRIPTS must stay path-scoped: a bare host wildcard here
    // would mount the caption adapter on every Amazon page.
    const injects = manifest.content_scripts.flatMap((cs) => cs.matches);
    expect(injects.filter((m) => /^(\*|https?):\/\/(\*\.)?amazon\.[a-z.]+\/\*$/.test(m))).toEqual([]);
    expect(injects.some((m) => m === '*://*.amazon.com/*')).toBe(false);
    // And the host permissions stay path-scoped too.
    expect(manifest.host_permissions.filter((m) => /^(\*|https?):\/\/(\*\.)?amazon\.[a-z.]+\/\*$/.test(m))).toEqual([]);
  });

  it('keeps primevideo.com intact', () => {
    for (const cs of manifest.content_scripts) {
      expect(cs.matches).toContain('*://*.primevideo.com/*');
    }
  });
});

describe('detectPlatform: amazon.* is Prime only under /gp/video', () => {
  it('treats a /gp/video page as Prime', () => {
    for (const tld of TLDS) {
      const host = `www.amazon.${tld}`;
      expect(isPrimeRoute(host, '/gp/video/detail/B0X'), tld).toBe(true);
    }
  });

  it('treats the domain WITHOUT www as Prime too', () => {
    // `*.amazon.com` in the manifest covers the bare host as well, so Chrome
    // injects the content script on `amazon.com/gp/video/...` — the detector
    // has to agree, or the page gets the generic HTML5 fallback instead of the
    // Prime adapter (no audio route, no DASH tracks).
    for (const tld of TLDS) {
      expect(isPrimeRoute(`amazon.${tld}`, '/gp/video/detail/B0X'), tld).toBe(true);
    }
  });

  it('accepts any other subdomain of the Amazon domain', () => {
    expect(isPrimeRoute('smile.amazon.com', '/gp/video/detail/B0X')).toBe(true);
    expect(isPrimeRoute('m.amazon.de', '/gp/video/detail/B0X')).toBe(true);
  });

  it('does NOT treat the rest of Amazon as Prime', () => {
    expect(isPrimeRoute('www.amazon.com', '/dp/B0X')).toBe(false);
    expect(isPrimeRoute('www.amazon.de', '/gp/cart')).toBe(false);
    expect(isPrimeRoute('www.amazon.co.uk', '/')).toBe(false);
    // Bare host on a non-Prime route stays out too: the path is what gates it.
    expect(isPrimeRoute('amazon.com', '/dp/B0X')).toBe(false);
  });

  it('does not read a lookalike domain as Amazon', () => {
    // `notamazon.com` ends with "amazon.com": the old check needed a dot in
    // front of the label, and dropping that anchor would let this through.
    expect(isPrimeRoute('notamazon.com', '/gp/video/detail/B0X')).toBe(false);
    expect(isPrimeRoute('amazon.com.evil.test', '/gp/video/detail/B0X')).toBe(false);
  });

  it('keeps primevideo.com as Prime everywhere', () => {
    expect(isPrimeRoute('www.primevideo.com', '/detail/B0X')).toBe(true);
    expect(isPrimeRoute('primevideo.com', '/')).toBe(true);
  });
});
