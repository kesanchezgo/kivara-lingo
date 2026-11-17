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
  const direct = t.url ?? t.downloadUrl;
  return typeof direct === 'string' && direct ? direct : null;
}

/** Extract the subtitle-relevant tracks from a parsed manifest-shaped value. */
export function extractManifestTracks(value: unknown): NetflixManifestTrack[] | null {
  if (!value || typeof value !== 'object') return null;
  const holder = value as Record<string, unknown>;
  const raw = holder.timedtexttracks;
  if (!Array.isArray(raw) || raw.length === 0) return null;
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
