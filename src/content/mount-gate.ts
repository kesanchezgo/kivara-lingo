/**
 * Mount gates per platform (point 1 of the Netflix QA wave).
 *
 * `findVideoContainer` used to fall back to "any <video>" on every host, so
 * Kivara mounted over the trailer a Netflix browse row autoplayed, over
 * YouTube's home-feed previews and over Prime's store pages. A known platform
 * now mounts ONLY on its real playback route and container; the any-video
 * fallback is left for hosts without an adapter.
 *
 * Kept pure (no window/document reads) so the gating rules are unit-testable.
 */

import { isPrimeHost, isPrimeRoute } from './platform-adapters/platform-hosts';

interface MountGate {
  /** Short name, for devLog lines. */
  platform: string;
  /** TRUE for the hostnames this gate owns. */
  hosts(host: string): boolean;
  /** Only these paths are playback: everything else on the host is not. */
  isPlayPath(pathname: string, host: string): boolean;
  /** Player containers in preference order, inside which the <video> must be. */
  selectors: readonly string[];
  /**
   * Mount on the player container even when the path is not in the table.
   * Only for platforms whose route list is known to be incomplete (Max and
   * Disney+ ship new paths without notice); Netflix and YouTube keep the hard
   * route gate because their storefronts autoplay trailers on other paths.
   */
  containerOverride?: boolean;
}

const startsWith = (...prefixes: readonly string[]) => (pathname: string, _host = ''): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(p));

const MOUNT_GATES: readonly MountGate[] = [
  {
    platform: 'youtube',
    hosts: (host) => /youtube\.com$/.test(host),
    // Watch pages and Shorts. NOT the home-feed previews, NOT /embed (the
    // in-page player other sites embed), NOT /results or the channel pages.
    isPlayPath: startsWith('/watch', '/shorts/'),
    selectors: ['.html5-video-player'],
  },
  {
    platform: 'netflix',
    hosts: (host) => /netflix\.com$/.test(host),
    // Playback lives under /watch/<id>. Browse rows autoplay trailers on the
    // home page — mounting there put the overlay over the storefront.
    isPlayPath: startsWith('/watch/'),
    selectors: ['.watch-video', '.watch-video--player-view'],
  },
  {
    platform: 'disney',
    hosts: (host) => /disneyplus\.com$/.test(host),
    // Disney+ prefixes the locale (`/es-es/video/<id>`) and plays under both
    // /video/ and /play/. The locale prefix is optional: the URL is rewritten
    // without it once the session is established.
    isPlayPath: (pathname) => /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:video|play)\//.test(pathname),
    selectors: ['.btm-media-player', '.btm-media-overlays'],
    containerOverride: true,
  },
  {
    platform: 'hbo',
    hosts: (host) => /(hbomax|max)\.com$/.test(host),
    // Max plays inside /video/... — documented with a real session in
    // docs/SUBTITLE-INTERCEPTION.md — plus the /episode/<id> and /movie/<id>
    // Fuse-Web-Play routes.
    isPlayPath: startsWith('/video/', '/episode/', '/movie/'),
    selectors: ['[data-testid="player-container"]', '#root'],
    containerOverride: true,
  },
  {
    platform: 'prime',
    // The eleven Amazon storefronts, shared with `detectPlatform`.
    hosts: isPrimeHost,
    // The owner's route table: all of primevideo.com, and the Amazon domains
    // only under /gp/video/ — the store pages share those hostnames.
    isPlayPath: (pathname, host) => isPrimeRoute(host, pathname),
    selectors: ['.webPlayerSDKContainer', '.atvwebplayersdk-player-container'],
  },
];

/** The gate that owns this hostname, if the host has a known platform. */
export function mountGateFor(host: string): MountGate | null {
  for (const gate of MOUNT_GATES) {
    if (gate.hosts(host)) return gate;
  }
  return null;
}

/**
 * TRUE when a known platform owns this host but the current path is NOT its
 * playback route — the state where any <video> on the page (a trailer, a
 * preview) must NOT trigger a mount.
 *
 * FALSE for hosts without a gate: the generic fallback still applies there.
 */
export function mountDenied(host: string, pathname: string): boolean {
  const gate = mountGateFor(host);
  if (!gate) return false;
  return !gate.isPlayPath(pathname, host);
}

/** TRUE when the host has a gate and the path is its playback route. */
export function isPlayRoute(host: string, pathname: string): boolean {
  const gate = mountGateFor(host);
  if (!gate) return false;
  return gate.isPlayPath(pathname, host);
}

/**
 * How long a SPA navigation may wait for the player DOM, per route. Play
 * routes get the full budget — on real Netflix the player takes longer than
 * the flat 3 s this used to be, and the handler then demounted and never
 * retried. Off-route keeps 3 s: trailers appear fast and the demount should
 * too.
 */
export function navWaitMs(host: string, pathname: string): number {
  return isPlayRoute(host, pathname) ? 15_000 : 3_000;
}
