# Subtitle Interception

How Kivara Lingo gets dual-language subtitles (source + native) from each
streaming platform without depending on the platform's UI to expose two
tracks at once. The goal is the same on every platform: when a cue
appears on screen, the bilingual line is already loaded so it shows up
in the same render — no MT round-trip, no perceptible lag, even after
seeking anywhere in the video.

This doc captures every moving part so the next maintainer can trace
through quickly when a platform breaks something.

## Architecture overview

```
┌────────────────────────────┐                ┌────────────────────────┐
│  MAIN-world interceptor    │  postMessage   │  ISOLATED-world bus    │
│  (main-world-interceptor)  │ ──────────────▶│  (intercepted-bus.ts)  │
│  patches fetch / XHR       │                │  - subtitle-track event│
│  on streaming hosts        │                │  - dash-manifest event │
└────────────────────────────┘                └─────────┬──────────────┘
                                                        │ tracksByLang
                                                        ▼
                                              ┌──────────────────────┐
                                              │   Adapter layer      │
                                              │   getAltCueAt(t,lang)│
                                              │   - youtube.ts       │
                                              │   - intercepted-     │
                                              │     adapter.ts       │
                                              │     (Netflix/HBO/    │
                                              │      Disney/Prime)   │
                                              └─────────┬────────────┘
                                                        │ SubtitleCue
                                                        ▼
                                              ┌──────────────────────┐
                                              │   App.tsx            │
                                              │   setAltCue(...)     │
                                              └─────────┬────────────┘
                                                        │
                                                        ▼
                                              ┌──────────────────────┐
                                              │   SubtitleOverlay    │
                                              │   nativeAltText →    │
                                              │   bilingual line     │
                                              └──────────────────────┘
```

## The two strategies

Different platforms expose subtitles differently. We support two:

### Strategy A — query-string translate (YouTube)

YouTube has a public-ish endpoint:
```
https://www.youtube.com/api/timedtext?v=…&lang=en
https://www.youtube.com/api/timedtext?v=…&lang=en&tlang=es&fmt=json3
```

Adding `tlang=<target>` makes YouTube auto-translate the source track to
the target language. We watch for the player downloading the source
track and fire a parallel fetch with `tlang=<user's target lang>` to
get the entire translated VTT in JSON3 format.

Code:
- `main-world-interceptor.ts` → `rewriteTimedtextLang()` rewrites `lang=`
  to the user's source language when the URL has no `tlang`. URLs that
  already carry `tlang` are left alone (those are explicit translation
  requests — either ours or YouTube's own auto-translate).
- `intercepted-bus.ts` → `maybeFetchTranslatedTrack()` fires the
  `?tlang=` request when we see a YouTube timedtext URL with no `tlang`.
- `parsers.ts` → `parseJSON3()` handles the events/segs/tStartMs format.
- `youtube.ts` adapter → reads `getAltCueAt(t, lang)` straight from the
  bus via `getTrackByLanguage()`.

### Strategy B — DASH manifest mining (HBO Max, Disney+, etc.)

These platforms ship a DASH MPD (Media Presentation Description) when
the player starts. The manifest is XML and lists every available track:

```xml
<AdaptationSet contentType="text" lang="es-419">
  <Role schemeIdUri="urn:mpeg:dash:role:2011" value="subtitle"/>
  <Label>es-419</Label>
  <Representation id="t22" mimeType="text/vtt">
    <SegmentTemplate
      media="t/dba5dc/t22/$Number$.vtt"
      startNumber="1"
      timescale="1000">
      <SegmentTimeline>
        <S t="0" d="647313"/>
      </SegmentTimeline>
    </SegmentTemplate>
  </Representation>
</AdaptationSet>
```

Even though the user only has ONE track selected in the player UI, the
manifest tells us where every track lives. We read it once, identify
the source-language and target-language tracks, and download both VTTs
ourselves.

Code:
- `main-world-interceptor.ts` → detects MPD bodies (`<MPD ...
  xmlns="urn:mpeg:dash:schema:mpd…"`) and posts them to the ISOLATED
  bus via a separate `MPD_EVENT`.
- `dash-subtitle-loader.ts` → `parseDashSubtitleTracks(mpdXml, mpdUrl)`
  walks every `<AdaptationSet contentType="text">` and resolves the
  `<SegmentTemplate>` into absolute URLs.
- `dash-subtitle-loader.ts` → `pickBestTrack(tracks, lang)` picks the
  best variant for a language: prefers `subtitle` over `caption` (SDH
  pollutes vocabulary mining), prefers regional variants like `es-419`
  / `pt-BR` when the manifest has them.
- `intercepted-bus.ts` → `handleDashManifest(url, body)` is wired to the
  MPD_EVENT. It calls pickBestTrack twice (source + target),
  downloads both, and stores them in `tracksByLang`.

## End-to-end flow on HBO Max

1. User opens `play.max.com/video/...`.
2. The MAIN-world interceptor (`run_at: document_start`, `world: MAIN`)
   patches `window.fetch` and `XMLHttpRequest`.
3. The HBO player runs and downloads the MPD from
   `cf.latam.prd.media.max.com/.../440660_fallback.mpd`.
4. Our patch sees the MPD body, detects it via the `<MPD xmlns="…">`
   header, and posts it to the ISOLATED world via
   `window.postMessage({ source: 'kivara-lingo:dash-manifest', url, body })`.
5. `intercepted-bus.ts` listens. It calls `parseDashSubtitleTracks` to
   get the list of every text AdaptationSet and `pickBestTrack` for both
   source (`en` → `en-US`) and target (`es` → `es-419`).
6. It downloads both VTTs in parallel via `downloadDashSubtitleTrack`
   (resolves the segment template, fetches each segment, parses with
   the standard WebVTT parser, concatenates the cues).
7. Each completed track is published to `tracksByLang.set('en', …)`
   and `tracksByLang.set('es', …)`, and a `track` event fires.
8. The `intercepted-adapter.ts` HBO adapter sees both tracks. It uses
   `tracksByLang.get(sourceLang)` for `onCueChange` (the source line)
   and `getAltCueAt(time, targetLang, sourceRange)` for the bilingual
   line.
9. App.tsx resolves the alt cue **synchronously** in the same React
   batch as `onCueChange` so both lines paint in the same frame, and
   also polls `getAltCueAt` every 50 ms as a safety net. It re-ticks
   on every new track, so the moment the second VTT finishes
   downloading the bilingual line "appears" already synced.

After step 6 completes (typically 200–800 ms after the first cue) the
user can seek anywhere in the video and both lines show up in the
same frame — no MT involved.

### Deterministic overlap-based alt cue lookup

The two language tracks are **authored independently** by each
platform — even when they describe the same dialogue, their
timestamps drift. Spanish line `[830080-834626]` and English line
`[829037-833200]` are the same caption, off by ~1 second. A naive
"find a cue whose `start <= t <= end`" lookup at `t = 829037` returns
nothing because the Spanish track hasn't started yet, and the user
sees the source line on screen with no bilingual line.

To handle this deterministically we pass the **source cue range** to
`getAltCueAt(timeMs, lang, sourceRange?)`. The adapter picks the alt
cue with the MAXIMUM TEMPORAL OVERLAP with the source range — for
any two non-empty cues that overlap at all, this always picks the
same alt cue regardless of how the timestamps drift. Fallback chain:

1. Range-aware overlap pick (when caller has the source range).
2. Strict containment of `timeMs` (the polling tick when no source
   cue is active, e.g. between cues).
3. Nearest cue by midpoint distance, within ±1.5 s of `timeMs`.
4. `null` (no plausible match — falls back to MT or hides the line).

Because step 1 runs synchronously inside `onCueChange`, the bilingual
line is resolved BEFORE React paints the source line, so both end up
in the same frame with no perceivable lag.

## Auto-language selection

The two language settings are synced from the Zustand store to the DOM
in `content/index.tsx`:

```ts
document.documentElement.setAttribute('data-kivara-source-lang', 'en');
document.documentElement.setAttribute('data-kivara-target-lang', 'es');
document.documentElement.setAttribute('data-kivara-auto-source-audio', '0' | '1');
```

The MAIN-world interceptor and the ISOLATED bus both read these
attributes (the MAIN script can't access `chrome.storage` or the
Zustand store, so a DOM attribute is the bridge).

When the user changes either language in the panel, two things happen:
1. `clearBus()` empties `tracksByLang` and `dashManifestsSeen`.
2. `reprocessLastDashManifest()` replays the last MPD we saw with the
   new language settings, so the user doesn't have to wait for the
   player to refresh its manifest.

### Audio auto-select (opt-in)

When `translate.autoSelectSourceAudio` is on, after we parse the MPD
we call `parseDashAudioTracks(body)` to enumerate every audio
language the platform offers. If the player's `<video>.audioTracks`
list contains a track whose `language` matches the user's
`sourceLang`, we set its `enabled` flag to `true` and disable the
others. This switches HBO Max / Disney+ / Prime audio to the source
language so the user hears AND reads what they're learning.

We never disable a track without enabling its replacement first, so
playback never goes silent during the swap.

Caveats:
- YouTube has only one audio track per video (no-op there).
- Netflix doesn't expose `audioTracks` on the `<video>` element
  (their player buffers via MSE without surfacing the track list).
- Safari's `audioTracks` API is behind a vendor prefix; we silently
  bail in that case. Chromium-based browsers work.

## When something breaks

### Scenario: dual subtitle stops appearing after a platform update

The platform probably changed something. To diagnose:

1. **Open the platform's video page with DevTools open.**
2. **Paste this probe in the console** (replace nothing — copy as-is):

```javascript
(() => {
  const TAG = '[KVL-PROBE]';
  const seen = new Set();
  const interesting = (url) => {
    const u = url.toLowerCase();
    return (
      /manifest|playback|playlist|metadata|subtitle|caption|webvtt|vtt|ttml|dfxp|texttrack|timedtext|wvtt/.test(u) ||
      /\.m3u8(\b|\?|$)/.test(u) ||
      /\.mpd(\b|\?|$)/.test(u)
    );
  };
  const log = (kind, url, body) => {
    if (seen.has(url)) return;
    seen.add(url);
    const peek = (body || '').slice(0, 600).replace(/\s+/g, ' ');
    console.log(`${TAG} ${kind}`, { url, bodyPeek: peek });
  };
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || args[0]?.href || '');
    const res = await origFetch.apply(this, args);
    if (interesting(url)) {
      try { log('fetch', url, await res.clone().text()); } catch { log('fetch', url, '(no body)'); }
    }
    return res;
  };
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__kvl_url = u; return origXhrOpen.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      const url = this.__kvl_url || '';
      if (!interesting(url)) return;
      try { log('xhr', url, this.responseText); } catch { log('xhr', url, '(no body)'); }
    });
    return origXhrSend.apply(this, args);
  };
  console.log(`${TAG} probe installed`);
})();
```

3. **Hit play.** Capture every URL with prefix `[KVL-PROBE]`.

What you're looking for, in priority order:

a. **Subtitle URLs** — anything ending in `.vtt`, `.ttml`, `.dfxp` or
   on a path like `/subtitle/`, `/caption/`, `/timedtext/`, `/t/sub/`.
   Note the URL pattern.

b. **Manifest URLs** — `.mpd` (DASH) or `.m3u8` (HLS) is what we need to
   parse to enumerate tracks. Note the URL pattern AND the body (first
   ~5KB tells us the format).

c. **Body format** — grab the first cue from the subtitle body. Is it
   WebVTT (`WEBVTT\n\n00:00:01.000 …`)? TTML (`<tt xmlns="…">`)? JSON3
   (`{"wireMagic":"pb3"…`)? The parser picks based on this.

### Common breakage patterns

| Symptom | Likely cause | Fix |
|---|---|---|
| `[KVL-PROBE]` fires but no `[Kivara Lingo / MAIN]` log | Interceptor not injected. Check `manifest.json` host match. | Add the new platform host to `content_scripts[*].matches`. |
| Interceptor sees the URL but bus stays empty | URL doesn't match `fastMatchers` or `SNIFF_HOSTS`, or `SKIP_EXT` is too aggressive | Add a new matcher in `main-world-interceptor.ts`. |
| Body intercepted but `parseAny` returns `[]` | Format we don't parse yet | Add a new parser in `parsers.ts`, register in `parseAny` and `detectSubtitleKind`. |
| Cues parse but language detected wrong | Heuristics in `detectTrackLanguage` / `languageFromUrl` don't handle the new pattern | Add a URL-pattern branch in `parsers.ts`. |
| Right language but seeking has lag | The platform serves segmented VTT (one segment per chunk) and we only got the first. | Inspect the manifest — segments are in `<SegmentTemplate>` / `<SegmentTimeline>`. Update `expandSegmentTemplate` in `dash-subtitle-loader.ts`. |
| MPD parsed but no tracks come out | Probably a new layout (different attribute names, different nesting). | Add a `console.log` in `parseDashSubtitleTracks` and inspect what the live MPD looks like. |

### Format-specific gotchas

**WebVTT** — usually fine, but some platforms strip the `WEBVTT` header
or use Windows line endings. The detector regex is permissive
(`/^\s*WEBVTT/i`).

**TTML** — Netflix and Prime use this, with an `xml:lang` on the root.
Some Prime variants use `dfxp` extension but the body is TTML.

**JSON3** — only YouTube uses it. The body has `events: [{tStartMs,
dDurationMs, segs: [{utf8}]}]` plus `aAppend: 1` markers we ignore
(those are continuation events for word-by-word reveal animations).

**MPD-DASH** — the format has many flavors (live, on-demand,
segmented, single-file). We only handle on-demand text tracks with a
`SegmentTemplate` + `SegmentTimeline`. If a platform ships a
single-file MPD (`<BaseURL>` only, no template), or a subscription-only
MPD with rotating tokens, we'd need to extend the loader.

**HLS-m3u8** — not supported yet. If a future platform uses HLS for
subtitles instead of DASH, we'd need to add an `m3u8` parser. The
shape is text-based and simpler than MPD; would parse the
`#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE=…,URI=…` lines and treat the
URI as the playlist of segments.

## DOM hardening (related)

The styling side of the extension lives behind the shadow DOM. The
hardening is documented in code comments in:

- `src/content/shadow-host.ts` — host setup, `:host` reset, Tailwind v4
  `--tw-*` seed (only for properties Tailwind declares with explicit
  `initial-value`), Dark Reader lock, legacy artifact cleanup.
- `src/styles/theme.css` — design tokens pinned to absolute pixels
  (`--text-xs`, `--spacing`, etc.) so the host's `html { font-size: 10px }`
  doesn't shrink the panel. `--kvl-font-sans` is the single source of
  truth for the font stack.

Common breakage patterns:

| Symptom | Likely cause | Fix |
|---|---|---|
| Text in subtitle / popover renders in YouTube's font (Roboto) | Shadow root inherits from host page | Pin `fontFamily: 'var(--kvl-font-sans)'` inline on the offending node. |
| Buttons / inputs render at wrong size | A style on `:host button { font-size: inherit }` or similar is winning over Tailwind utilities | Remove the broad rule and let Tailwind Preflight handle it. |
| White halo / shadow around buttons in dark mode | `--tw-*` properties seeded with empty string (breaks `var(name, fallback)` semantics) | Only seed properties Tailwind declares with `initial-value`. |
| Panel scaled too small on YouTube | `html { font-size: 10px }` propagates through `rem` | Confirm `--text-*` and `--spacing` in `theme.css` are in `px`, not `rem`. |

## Files to know

| File | Purpose |
|---|---|
| `src/content/platform-adapters/main-world-interceptor.ts` | MAIN-world fetch/XHR patch, fast matchers, sniff hosts, source-lang rewrite for YouTube |
| `src/content/platform-adapters/intercepted-bus.ts` | ISOLATED-world bus, MPD handler, YouTube auto-translate fetch, language-keyed track cache |
| `src/content/platform-adapters/parsers.ts` | WebVTT / TTML / DFXP / JSON3 parsers, language detection from URL/body |
| `src/content/platform-adapters/dash-subtitle-loader.ts` | MPD parser + segment expander + multi-segment downloader + best-track picker |
| `src/content/platform-adapters/intercepted-adapter.ts` | Generic adapter for Netflix/HBO/Disney/Prime that consumes the bus |
| `src/content/platform-adapters/youtube.ts` | YouTube-specific adapter (DOM polling for cue boundaries + bus consumption for alt language) |
| `src/content/index.tsx` | Bootstrapper, syncs Zustand language to DOM attributes, calls `clearBus()` + `reprocessLastDashManifest()` on language change or SPA nav |
| `src/content/ui/App.tsx` | Adapter glue, synchronous alt-cue resolution in `onCueChange`, `getAltCueAt` polling at 50 ms, `onTrack`-driven re-ticks |
| `src/content/ui/SubtitleOverlay.tsx` | Renders the source + bilingual lines, MT fallback when neither bus track has the language |
| `src/background/translate.ts` | MT chain (MyMemory / Lingva / DeepL / Google) — fallback only |

