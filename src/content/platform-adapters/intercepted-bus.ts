/**
 * ISOLATED-world side of the MAIN-world subtitle interceptor.
 *
 * Listens for `window.postMessage` events that the MAIN-world script posts,
 * collects them into language-keyed tracks and exposes a tiny API the
 * platform adapters use to drive `onCueChange`.
 *
 * Multiple language tracks may arrive in any order (the player loads them
 * in parallel as the user picks an audio/subtitle pair). We keep:
 *   - `lastTrack`     — the most recently seen track of any language. Used
 *                       by the adapter as the "primary" caption source so
 *                       legacy behaviour is preserved.
 *   - `tracksByLang`  — every track we've seen, keyed by primary subtag
 *                       (`es`, `en`, ...). Used by Tier B to pull the
 *                       native-language dual caption.
 *
 * **YouTube auto-translate**: when we see a YouTube `/api/timedtext` URL
 * with the source language but no `tlang`, we kick off a parallel fetch
 * with `tlang=<user's native language>` to populate the bus with the
 * translated track. YouTube serves it as a regular VTT/JSON3 over HTTPS,
 * so the user can seek anywhere in the video and the bilingual line is
 * already loaded — exactly the same UX YouTube's own "auto-translate"
 * setting offers, but driven by our extension settings.
 */
import { parseAny, detectTrackLanguage, type RawCue } from './parsers';
import {
  parseDashSubtitleTracks,
  downloadDashSubtitleTrack,
  pickBestTrack,
} from './dash-subtitle-loader';

const EVENT = 'kivara-lingo:subtitle-track';
const MPD_EVENT = 'kivara-lingo:dash-manifest';

export interface InterceptedTrack {
  url: string;
  cues: RawCue[];
  language: string | null;
}

type TrackListener = (track: InterceptedTrack) => void;

const listeners = new Set<TrackListener>();
const seenUrls = new Set<string>();
const tracksByLang = new Map<string, InterceptedTrack>();
let lastTrack: InterceptedTrack | null = null;

function isOurMessage(
  payload: unknown,
): payload is { source: string; url: string; cues: RawCue[]; language?: unknown } {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as { source?: unknown; url?: unknown; cues?: unknown };
  return p.source === EVENT && typeof p.url === 'string' && Array.isArray(p.cues);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as unknown;
  // DASH manifest — a separate code path that parses every subtitle track
  // declared in the MPD and downloads the one in the user's target
  // language. This gives platforms that don't ship a per-language
  // endpoint (HBO Max, Disney+, etc.) the same zero-latency dual line as
  // YouTube.
  if (
    data &&
    typeof data === 'object' &&
    (data as { source?: unknown }).source === MPD_EVENT
  ) {
    const m = data as { url?: unknown; body?: unknown };
    if (typeof m.url === 'string' && typeof m.body === 'string') {
      void handleDashManifest(m.url, m.body);
    }
    return;
  }
  if (!isOurMessage(event.data)) return;
  const url = event.data.url;
  const cues = event.data.cues;
  if (!cues.length) return;
  const language =
    typeof event.data.language === 'string' && event.data.language ? event.data.language : null;

  // De-dup identical track downloads — but always replace `lastTrack` so a
  // new track (different timestamps) immediately drives the active cue
  // selector. For language-keyed lookups we also store on the latest URL.
  const alreadySeen = seenUrls.has(url) && lastTrack?.url === url;
  if (alreadySeen) return;
  seenUrls.add(url);

  const next: InterceptedTrack = { url, cues, language };
  lastTrack = next;
  if (language) {
    // Normalize to a 2-letter primary subtag so `es`, `es-419`, `es-ES`
    // and `ES` all collide on the same key. Lookup uses the same rule.
    const key = language.trim().toLowerCase().split(/[-_]/)[0];
    if (key) tracksByLang.set(key, next);
  }

  listeners.forEach((l) => {
    try {
      l(next);
    } catch (err) {
      console.warn('[Kivara Lingo] track listener threw', err);
    }
  });

  // YouTube only — auto-fetch the translated track once we've seen the
  // source-language original. This gives the user the entire video's
  // bilingual line cached in memory the moment captions load, so seeking
  // anywhere shows both subtitles in the same frame.
  void maybeFetchTranslatedTrack(url, language);
});

/**
 * Per-tab guard so we don't re-process the same MPD manifest twice (DASH
 * players reload the manifest every few minutes for live edge updates).
 */
const dashManifestsSeen = new Set<string>();

/**
 * Last MPD body we saw, kept so we can re-fire the language-track download
 * when the user changes their source/target language in the panel without
 * having to wait for the player to refresh its manifest.
 */
let lastMpdBody: { url: string; body: string } | null = null;

/**
 * Handle a DASH manifest: parse, identify both the source-language and
 * target-language subtitle tracks, download whichever isn't already in
 * the bus, and publish the cues so the adapter's `getAltCueAt` can
 * resolve them.
 *
 * Mirrors the YouTube `?tlang=…` flow but for platforms that ship
 * MPD-DASH (HBO Max, some Disney+ assets, etc.). Auto-fetching BOTH
 * source and target means the user doesn't have to fiddle with the
 * platform's subtitle menu — once we see the manifest we know every
 * available language and can pull the two we need straight from the
 * CDN, exactly the way Migaku / Trancy / Language Reactor do it.
 */
async function handleDashManifest(mpdUrl: string, body: string): Promise<void> {
  if (dashManifestsSeen.has(mpdUrl)) return;
  dashManifestsSeen.add(mpdUrl);
  lastMpdBody = { url: mpdUrl, body };

  const sourceLang = (
    document.documentElement.getAttribute('data-kivara-source-lang') || 'en'
  ).toLowerCase();
  const targetLang = (
    document.documentElement.getAttribute('data-kivara-target-lang') || 'es'
  ).toLowerCase();
  const sourcePrimary = sourceLang.split(/[-_]/)[0];
  const targetPrimary = targetLang.split(/[-_]/)[0];

  let tracks;
  try {
    tracks = parseDashSubtitleTracks(body, mpdUrl);
  } catch (err) {
    console.warn('[Kivara Lingo] MPD parse failed', err);
    return;
  }
  if (tracks.length === 0) return;

  // Fetch the source-language track if the player hasn't already
  // requested it. On platforms where the user has a DIFFERENT default
  // subtitle selected (e.g. LATAM HBO accounts default to Spanish CC
  // even when the user wants English), this is what makes the source
  // line show up at all.
  if (
    sourcePrimary &&
    sourcePrimary !== targetPrimary &&
    !tracksByLang.has(sourcePrimary)
  ) {
    const src = pickBestTrack(tracks, sourceLang);
    if (src) void downloadAndPublishDashTrack(src, sourcePrimary);
  }
  // Fetch the target-language (native) track for the dual line.
  if (targetPrimary && !tracksByLang.has(targetPrimary)) {
    const tgt = pickBestTrack(tracks, targetLang);
    if (tgt) void downloadAndPublishDashTrack(tgt, targetPrimary);
  }
}

/**
 * Download every segment of a DASH subtitle track, store it in the
 * bus under `langKey`, and notify all listeners.
 */
async function downloadAndPublishDashTrack(
  track: import('./dash-subtitle-loader').DashSubtitleTrack,
  langKey: string,
): Promise<void> {
  let cues: RawCue[];
  try {
    cues = await downloadDashSubtitleTrack(track);
  } catch (err) {
    console.warn('[Kivara Lingo] DASH track download failed', err);
    return;
  }
  if (cues.length === 0) return;
  const trackUrl =
    track.segmentUrls[0] ?? `dash:${track.id}:${track.representationId}`;
  const tTrack: InterceptedTrack = {
    url: trackUrl,
    cues,
    language: track.fullLanguage,
  };
  lastTrack = tTrack;
  tracksByLang.set(langKey, tTrack);
  seenUrls.add(trackUrl);
  listeners.forEach((l) => {
    try {
      l(tTrack);
    } catch (err) {
      console.warn('[Kivara Lingo] track listener threw', err);
    }
  });
}

/**
 * Per-tab guard so we don't fetch the same translated URL twice. Keys are
 * the (untranslated) source URL.
 */
const translatedRequested = new Set<string>();

async function maybeFetchTranslatedTrack(
  url: string,
  language: string | null,
): Promise<void> {
  // YouTube identifier — `/api/timedtext` requests with NO `tlang`
  // already in the URL. The user-selected target language comes from
  // localStorage (we sync it from Zustand on every change).
  if (!/\/api\/timedtext\b/.test(url)) return;
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return;
  }
  // Skip if YouTube itself is already requesting a translated version.
  if (parsed.searchParams.get('tlang')) return;

  // Read the user's native (target) language from the dataset attribute
  // we set in the isolated-world content script. Fallback to "es" so the
  // ISOLATED-world bus still works during early bootstrap before the
  // attribute is set.
  const targetLang =
    document.documentElement.getAttribute('data-kivara-target-lang') || 'es';
  const target = targetLang.trim().toLowerCase().split(/[-_]/)[0];
  if (!target) return;

  const sourceKey = language?.trim().toLowerCase().split(/[-_]/)[0] ?? null;
  // Skip if the source IS already the target language (no translation needed).
  if (sourceKey === target) return;
  // Skip if we already have a track in the target language (real native
  // pista) — we don't want to clobber it with a YouTube auto-translate.
  if (tracksByLang.has(target)) return;

  // Translated URL = same URL + `&tlang=<target>`. Force `fmt=json3`
  // because that's the format YouTube uses by default and the parser we
  // ship is heavily exercised on it. (`fmt=vtt` also works but YouTube
  // sometimes serves a stripped version with no `Language:` header.)
  parsed.searchParams.set('tlang', target);
  parsed.searchParams.set('fmt', 'json3');
  const translatedUrl = parsed.toString();
  if (translatedRequested.has(translatedUrl)) return;
  translatedRequested.add(translatedUrl);

  try {
    const res = await fetch(translatedUrl, { credentials: 'include' });
    if (!res.ok) {
      return;
    }
    const body = await res.text();
    const tCues = parseAny(translatedUrl, body);
    if (!tCues.length) {
      return;
    }
    // The translated body sometimes carries its own `Language: es` header,
    // but the URL `tlang=es` is the authoritative source — use it.
    const tLanguage = detectTrackLanguage(translatedUrl, body) ?? target;
    const tTrack: InterceptedTrack = {
      url: translatedUrl,
      cues: tCues,
      language: tLanguage,
    };
    lastTrack = tTrack;
    tracksByLang.set(target, tTrack);
    seenUrls.add(translatedUrl);
    listeners.forEach((l) => {
      try {
        l(tTrack);
      } catch (err) {
        console.warn('[Kivara Lingo] track listener threw', err);
      }
    });
  } catch {
    // Network failed — non-fatal, the bilingual line falls back to MT.
  }
}

export function onTrack(listener: TrackListener): () => void {
  listeners.add(listener);
  // Replay last track if we already have one — adapters can mount late.
  if (lastTrack) {
    try {
      listener(lastTrack);
    } catch {
      // ignore
    }
  }
  return () => listeners.delete(listener);
}

export function getLastTrack(): InterceptedTrack | null {
  return lastTrack;
}

/**
 * Return the most recently seen track for a given primary language subtag
 * (`es`, `en`, ...). Returns `null` when no track for that language has
 * been intercepted yet.
 */
export function getTrackByLanguage(lang: string): InterceptedTrack | null {
  const key = lang.trim().toLowerCase().split(/[-_]/)[0];
  if (!key) return null;
  return tracksByLang.get(key) ?? null;
}

/** List of language codes seen so far. */
export function getKnownLanguages(): string[] {
  return Array.from(tracksByLang.keys());
}

/**
 * Return the FULL cue list for the most recently seen track. Used by the
 * prefetch logic to pre-translate upcoming cues while the current one
 * shows, so the bilingual line never lags behind.
 */
export function getActiveTrackCues(): RawCue[] | null {
  return lastTrack?.cues ?? null;
}

/**
 * Clear all cached tracks. Called by the content script whenever the user
 * navigates to a new video (SPA URL change) so we don't leak stale cues
 * from a previous video into the new one.
 *
 * Also called when the user changes their target language in the panel —
 * the previously fetched `?tlang=es` URL is no longer relevant if they
 * now want Portuguese, and `translatedRequested` would otherwise prevent
 * the new fetch.
 */
export function clearBus(): void {
  tracksByLang.clear();
  seenUrls.clear();
  translatedRequested.clear();
  dashManifestsSeen.clear();
  lastTrack = null;
  lastMpdBody = null;
}

/**
 * Re-run DASH manifest processing using the most recently seen manifest.
 * Called when the user changes their source/target language so the bus
 * can pick up the newly-needed track without waiting for the player to
 * refresh its manifest. Returns silently when no manifest has been seen
 * (e.g. on YouTube, which uses /api/timedtext instead).
 */
export function reprocessLastDashManifest(): void {
  if (!lastMpdBody) return;
  // Reset the seen-set so handleDashManifest will run again.
  dashManifestsSeen.delete(lastMpdBody.url);
  void handleDashManifest(lastMpdBody.url, lastMpdBody.body);
}
