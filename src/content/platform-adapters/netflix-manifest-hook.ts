/**
 * The MAIN-world hook that captures Netflix's playback manifest.
 *
 * Netflix's player fetches the manifest through its own MSL stack and parses
 * the DECRYPTED payload with `JSON.parse` — the network body is opaque, so
 * the only seam where the parsed manifest exists is that parse. The hook
 * wraps `JSON.parse` once, looks for objects carrying `timedtexttracks`
 * (each with its `bcp47` and a downloadable TTML URL), and posts the extract
 * to the ISOLATED bus over the same postMessage channel as the subtitle
 * tracks. The bus then downloads the native-language track the way the MPD
 * flow already does for HBO Max / Disney+.
 *
 * E2E: the fixture marks the document (`data-kivara-e2e-netflix-manifest`)
 * and calls JSON.parse with the same shape — the hook fires there too, so
 * the specs can simulate the manifest without a real MSL stack.
 */

import { primarySubtag } from './timed-text';

export const NETFLIX_MANIFEST_EVENT = 'kivara-lingo:netflix-manifest';

export interface NetflixManifestTrack {
  bcp47?: string;
  isNoneTrack?: boolean;
  isForcedNarrative?: boolean;
  isImageBased?: boolean;
  ttDownloadUrl?: string;
}

/** @internal Pull the downloadable TTML URL out of one manifest track. The shape has
 * moved across player versions — try every known carrier. */
function extractTrackUrl(track: unknown): string | null {
  if (!track || typeof track !== 'object') return null;
  const t = track as Record<string, unknown>;
  const ttDownload = t.ttDownload;
  if (Array.isArray(ttDownload)) {
    for (const entry of ttDownload) {
      if (entry && typeof entry === 'object') {
        const url = (entry as Record<string, unknown>).url;
        if (typeof url === 'string' && url) return url;
        const cdnlist = (entry as Record<string, unknown>).cdnlist;
        if (Array.isArray(cdnlist)) {
          for (const cdn of cdnlist) {
            if (cdn && typeof cdn === 'object') {
              const cUrl = (cdn as Record<string, unknown>).url;
              if (typeof cUrl === 'string' && cUrl) return cUrl;
            }
          }
        }
      }
    }
  }
  // Real Cadmium manifests carry `ttDownloadables`: a per-profile object
  // whose keys are profile ids. Only text profiles are useful (XML/VTT);
  // image profiles (`isImage` / `nflx-cmisc` per-glyph bitmaps) cannot be
  // parsed into cues. Each profile exposes its URL either as a `urls` array
  // or as a `downloadUrls` map.
  const downloadables = t.ttDownloadables;
  if (downloadables && typeof downloadables === 'object') {
    const entries = Object.entries(downloadables as Record<string, unknown>);
    const usable = (value: unknown): string | null => {
      if (!value || typeof value !== 'object') return null;
      const p = value as Record<string, unknown>;
      if (p.isImage === true) return null;
      const urls = p.urls;
      if (Array.isArray(urls)) {
        for (const u of urls) {
          const url = (u as Record<string, unknown> | null)?.url;
          if (typeof url === 'string' && url) return url;
        }
      }
      const downloadUrls = p.downloadUrls;
      if (downloadUrls && typeof downloadUrls === 'object') {
        for (const v of Object.values(downloadUrls as Record<string, unknown>)) {
          if (typeof v === 'string' && v) return v;
          const url = (v as Record<string, unknown> | null)?.url;
          if (typeof url === 'string' && url) return url;
        }
      }
      return null;
    };
    // Preferred order: the standard text-subtitle profiles, best first.
    const preferred = ['imsc1.1', 'dfxp-ls-sdh', 'simplesdh', 'webvtt-lssdh-ios8'];
    for (const profile of preferred) {
      if (profile in (downloadables as Record<string, unknown>)) {
        const url = usable((downloadables as Record<string, unknown>)[profile]);
        if (url) return url;
      }
    }
    // Unlisted-but-text profile: take the first usable one (image/cmisc
    // profiles are skipped inside `usable`).
    for (const [id, value] of entries) {
      if (id.includes('nflx-cmisc')) continue;
      const url = usable(value);
      if (url) return url;
    }
  }
  const direct = t.url ?? t.downloadUrl;
  return typeof direct === 'string' && direct ? direct : null;
}

/**
 * Find every `timedtexttracks` array inside manifest-shaped values. Netflix
 * ships at least two envelopes: the player-local `{ timedtexttracks }` and
 * the MSL service reply `{ result: { timedtexttracks } }` — and some paths
 * deliver ARRAYS of either. Walk plain objects/arrays and collect EVERY
 * array found, down to depth 2 (player-local = 0, MSL result = 1, an
 * envelope inside an array = 2). Deeper nesting is not a manifest.
 */
function collectTimedTextTracks(value: unknown, depth: number, out: unknown[]): void {
  if (depth > 2 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTimedTextTracks(item, depth + 1, out);
    }
    return;
  }
  const holder = value as Record<string, unknown>;
  const raw = holder.timedtexttracks;
  if (Array.isArray(raw) && raw.length > 0) {
    out.push(...raw);
    return;
  }
  for (const child of Object.values(holder)) {
    if (child && typeof child === 'object') collectTimedTextTracks(child, depth + 1, out);
  }
}

/** Extract the subtitle-relevant tracks from a parsed manifest-shaped value. */
export function extractManifestTracks(value: unknown): NetflixManifestTrack[] | null {
  const raw: unknown[] = [];
  collectTimedTextTracks(value, 0, raw);
  if (raw.length === 0) return null;
  const tracks: NetflixManifestTrack[] = [];
  for (const track of raw) {
    if (!track || typeof track !== 'object') continue;
    const t = track as Record<string, unknown>;
    const bcp47 = typeof t.bcp47 === 'string' ? t.bcp47 : undefined;
    if (!bcp47) continue;
    tracks.push({
      bcp47,
      isNoneTrack: t.isNoneTrack === true,
      isForcedNarrative: t.isForcedNarrative === true,
      isImageBased: t.isImageBased === true,
      ttDownloadUrl: extractTrackUrl(track) ?? undefined,
    });
  }
  return tracks.length > 0 ? tracks : null;
}

/**
 * Pick the downloadable NATIVE track for `lang`, mirroring the player-track
 * rule in `pickTimedTextTrack` (timed-text.ts). A forced-narrative track is
 * NEVER native: it carries only on-screen foreign dialogue and is nearly
 * empty for a dubbed episode, so it is excluded outright rather than merely
 * ranked last — if only a forced track exists we return null and the bus
 * keeps its automatic-translation fallback.
 */
export function pickNetflixManifestTrack(
  tracks: readonly NetflixManifestTrack[],
  lang: string,
): NetflixManifestTrack | null {
  const want = primarySubtag(lang);
  if (!want) return null;
  const candidates = tracks.filter((t) =>
    !t.isNoneTrack && !t.isImageBased && !t.isForcedNarrative
      && !!t.ttDownloadUrl && primarySubtag(t.bcp47) === want,
  );
  return candidates[0] ?? null;
}

/**
 * Install the manifest hook ONLY on a Netflix origin. The MAIN-world
 * interceptor is injected on every supported platform (the same script also
 * sniffs MPD/WebVTT), but wrapping JSON.parse is invasive: on YouTube or a
 * player it must stay byte-for-byte the page's own parse. Exact host or a
 * `*.netflix.com` subdomain; a look-alike like `netflix.com.evil.test` must
 * not match.
 */
export function maybeInstallNetflixManifestHook(
  win: Window & { JSON: JSON },
  post: (tracks: NetflixManifestTrack[]) => void,
): () => void {
  const host = (win.location?.hostname ?? '').toLowerCase();
  if (host !== 'netflix.com' && !host.endsWith('.netflix.com')) return () => {};
  return installNetflixManifestHook(win, post);
}

/** Install the JSON.parse hook. Idempotent; the original parse is restored
 * by the returned cleanup (the interceptor's uninstall). */
export function installNetflixManifestHook(
  win: Window & { JSON: JSON },
  post: (tracks: NetflixManifestTrack[]) => void,
): () => void {
  const json = win.JSON;
  if ((json as unknown as { __kivaraManifestHook?: boolean }).__kivaraManifestHook) {
    return () => {};
  }
  (json as unknown as { __kivaraManifestHook?: boolean }).__kivaraManifestHook = true;
  const originalParse = json.parse.bind(json);
  const patchedParse = function parse(this: unknown, text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
    const result = originalParse(text, reviver);
    try {
      const tracks = extractManifestTracks(result);
      if (tracks) post(tracks);
    } catch {
      /* a manifest probe must never break the page's parse */
    }
    return result;
  } as JSON['parse'];
  (patchedParse as unknown as { __kivaraOriginal?: JSON['parse'] }).__kivaraOriginal = originalParse;
  json.parse = patchedParse;
  return () => {
    json.parse = originalParse;
    (json as unknown as { __kivaraManifestHook?: boolean }).__kivaraManifestHook = false;
  };
}
