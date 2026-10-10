import { createRoot, type Root } from 'react-dom/client';
import { ShadowHost } from './shadow-host';
import { detectPlatform } from './platform-adapters';
import { App } from './ui/App';
import type { SubtitleSource } from './platform-adapters/types';
import { useKivaraStore } from '../shared/store';
import { clearBus, reprocessLastDashManifest } from './platform-adapters/intercepted-bus';
import { bumpMountGen, enqueueMount, readMountGen } from './mount-queue';
import { setYomitanHeadwords } from './nlp/yomitan-headwords';

console.log('[Kivara Lingo] content script injected on', window.location.hostname);

/**
 * Hydrate the in-memory headword cache used by the tokenizer so words
 * outside the bundled `en.json` (excuse, pee, pants, seventh, grade…)
 * but covered by an installed Yomitan pack get classified as `known`.
 *
 * The SW owns the IndexedDB connection (the content-script context sees
 * the host site's DB, not the extension's), so we round-trip through
 * `chrome.runtime.sendMessage`. The response carries up to ~1.5M
 * lowercased strings — large but a one-time cost per tab.
 */
function hydrateYomitanHeadwords() {
  const lang = useKivaraStore.getState().translate.sourceLang || 'en';
  try {
    chrome.runtime.sendMessage(
      { type: 'GET_YOMITAN_HEADWORDS', lang },
      (response: { ok: boolean; headwords?: string[] } | undefined) => {
        // Drain runtime.lastError so an unreachable SW doesn't surface
        // as an unchecked warning.
        void chrome.runtime.lastError;
        if (response?.ok && Array.isArray(response.headwords)) {
          setYomitanHeadwords(response.headwords);
        }
      },
    );
  } catch {
    // Non-extension context (tests / prototype) — silent no-op.
  }
}
hydrateYomitanHeadwords();
// Re-pull whenever the user installs / toggles / deletes a pack so the
// tokenizer reflects the new coverage without a page reload.
chrome.runtime.onMessage.addListener((msg) => {
  if (
    msg?.type === 'DICT_PACK_PROGRESS' &&
    (msg.stage === 'done' || msg.stage === 'error')
  ) {
    hydrateYomitanHeadwords();
  } else if (msg?.type === 'DICT_PACKS_CHANGED') {
    hydrateYomitanHeadwords();
  }
});

// Sync the user's configured source language to a DOM attribute so the
// MAIN-world interceptor (which can't access chrome.storage or the Zustand
// store) can read it and rewrite YouTube's timedtext lang parameter.
function syncSourceLangToDOM() {
  const lang = useKivaraStore.getState().translate.sourceLang || 'en';
  document.documentElement.setAttribute('data-kivara-source-lang', lang);
}
syncSourceLangToDOM();

// Same idea for the user's TARGET (native) language. The intercepted-bus
// reads this attribute to decide which `tlang=` parameter to append when
// auto-fetching YouTube's translated track for the bilingual line.
function syncTargetLangToDOM() {
  const lang = useKivaraStore.getState().translate.targetLanguage || 'es';
  document.documentElement.setAttribute('data-kivara-target-lang', lang);
}
syncTargetLangToDOM();

// Audio auto-selection toggle — see TranslateSettings.autoSelectSourceAudio
// for rationale. Stored as a DOM attribute so the ISOLATED-world bus can
// branch on it without importing the Zustand store.
function syncAutoSourceAudioToDOM() {
  const on = useKivaraStore.getState().translate.autoSelectSourceAudio;
  document.documentElement.setAttribute(
    'data-kivara-auto-source-audio',
    on ? '1' : '0',
  );
}
syncAutoSourceAudioToDOM();
useKivaraStore.subscribe((state, prev) => {
  if (state.translate.sourceLang !== prev.translate.sourceLang) {
    syncSourceLangToDOM();
    // Source language changed — the previously-cached translated track
    // was relative to the old source. Drop it so the next caption load
    // re-derives the bilingual line.
    clearBus();
    // For DASH platforms (HBO Max, etc.) the manifest URL is stable but
    // the bus has just been emptied; replay the last manifest so the
    // newly-needed source track gets fetched without waiting for the
    // player to reload.
    reprocessLastDashManifest();
    // Yomitan headwords are language-scoped — re-pull for the new lang.
    hydrateYomitanHeadwords();
  }
  if (state.translate.targetLanguage !== prev.translate.targetLanguage) {
    syncTargetLangToDOM();
    // Target language changed — same reasoning. The user wants Portuguese
    // now, the bus has Spanish cached; force a re-fetch.
    clearBus();
    reprocessLastDashManifest();
  }
  if (
    state.translate.autoSelectSourceAudio !== prev.translate.autoSelectSourceAudio
  ) {
    syncAutoSourceAudioToDOM();
    // Replay the last manifest so the audio-track switch fires
    // immediately when the user flips the toggle on, instead of
    // waiting for the player to reload.
    reprocessLastDashManifest();
  }
});

interface Mount {
  hostElement: HTMLElement;
  reactRoot: Root;
  videoHostElement?: HTMLElement;
  videoReactRoot?: Root;
  /** Kept so `unmount()` can release the adapter's timers and listeners. */
  adapter: SubtitleSource | null;
}

let mount: Mount | null = null;
let lastVideoElement: HTMLVideoElement | null = null;
let lastVideoContainer: HTMLElement | null = null;
/**
 * Identity of the media currently mounted. YouTube reuses the SAME <video>
 * element across SPA navigation, so element identity alone cannot tell "same
 * video" from "next video in the playlist" — and comparing the whole URL would
 * remount on every `&t=` / `#t=` / `&pp=` tweak the platform makes (auto-skip
 * alone changes the URL several times while a video plays). Only the bits that
 * identify the asset are compared.
 */
let lastMediaId: string | null = null;

/** Stable identifier for what is being played: the YouTube `v=` (or `shorts/`),
 * or the pathname for the platforms that key their player by URL. Timestamps
 * (`#t=`), autoplay and playlist params are ignored — the player rewrites them
 * while a video keeps running, and remounting on each write both loses the
 * panel state and spikes the CPU. */
function currentMediaId(): string {
  const url = new URL(window.location.href);
  // YouTube Shorts: /shorts/<id> — the id is in the path, and it must not be
  // confused with the `v=` namespace above.
  const shorts = /^\/shorts\/([\w-]+)/.exec(url.pathname);
  if (shorts) return `shorts:${shorts[1]}`;
  const videoId =
    url.searchParams.get('v') ?? url.searchParams.get('movieId') ?? url.searchParams.get('jbv');
  if (videoId) return `v:${videoId}`;
  return url.pathname;
}

function findVideoContainer(): { video: HTMLVideoElement | null; container: HTMLElement | null } {
  const host = window.location.hostname;

  // Per-platform anchor preferences. Falls back to the video's parent element
  // for unknown layouts.
  const platformSelectors: Array<{ test: RegExp; selectors: string[] }> = [
    { test: /youtube\.com$/, selectors: ['.html5-video-player'] },
    { test: /netflix\.com$/, selectors: ['.watch-video', '.watch-video--player-view'] },
    { test: /disneyplus\.com$/, selectors: ['.btm-media-player', '.btm-media-overlays'] },
    { test: /(hbomax|max)\.com$/, selectors: ['#root', '[data-testid="player-container"]'] },
    {
      test: /primevideo\.com$/,
      selectors: ['.webPlayerSDKContainer', '.atvwebplayersdk-player-container'],
    },
  ];

  for (const { test, selectors } of platformSelectors) {
    if (!test.test(host)) continue;
    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        const video = el.querySelector<HTMLVideoElement>('video');
        if (video) return { video, container: el };
      }
    }
  }

  const video = document.querySelector<HTMLVideoElement>('video');
  return {
    video,
    container: (video?.parentElement as HTMLElement | null) ?? null,
  };
}

async function waitForVideo(timeoutMs = 15000): Promise<{ video: HTMLVideoElement; container: HTMLElement } | null> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const { video, container } = findVideoContainer();
    if (video && container) return { video, container };
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

function unmount() {
  if (!mount) return;
  try {
    mount.reactRoot.unmount();
  } catch {
    // ignore
  }
  try {
    mount.videoReactRoot?.unmount();
  } catch {
    // ignore
  }
  // The adapter owns timers, bus subscriptions and injected styles that a
  // React unmount does NOT touch. Without this, every SPA navigation left the
  // previous adapter polling and answering with the previous video's cues.
  try {
    mount.adapter?.destroy?.();
  } catch (err) {
    console.warn('[Kivara Lingo] adapter destroy failed', err);
  }
  mount.hostElement.remove();
  mount.videoHostElement?.remove();
  mount = null;
}

/**
 * Mount serialization (race fix) — implementation lives in
 * `mount-queue.ts` (extracted so its generation invariant is unit-testable
 * without importing this entry point, which starts a 15 s video poll).
 *
 * `init()` awaits `waitForVideo()` for up to 15 s before its first mount,
 * while `handleNavigation()` can fire from popstate / yt-navigate during
 * that window. Without serialization, two concurrent `mountFor()` calls
 * interleave unmount → createRoot → assign `mount`, orphaning React roots.
 * Without the generation guard, a stale `init()` could mount the OLD video
 * after a navigation already mounted the new one.
 */

async function mountFor(video: HTMLVideoElement, container: HTMLElement, adapter: SubtitleSource | null) {
  unmount();

  // Ensure the container can host an absolutely-positioned overlay
  const computed = window.getComputedStyle(container);
  if (computed.position === 'static') {
    container.style.position = 'relative';
  }

  const host = ShadowHost.mount(document.body);
  const videoHost = ShadowHost.mount(container, { isOverlay: true });

  const reactRoot = createRoot(host.reactRoot);
  const videoReactRoot = createRoot(videoHost.reactRoot);

  // We use a single React tree mounted in the main host (which uses a portal
  // to render into the video-overlay shadow root). This keeps state in one
  // tree even though the DOM lives in two shadow hosts.
  // To keep it simple, we render `App` once and pass the overlay root.
  videoReactRoot.unmount();

  reactRoot.render(<App adapter={adapter} videoElement={video} videoOverlayRoot={videoHost.reactRoot} />);

  adapter?.hideNativeSubtitles?.();

  mount = {
    hostElement: host.hostElement,
    reactRoot,
    videoHostElement: videoHost.hostElement,
    adapter,
  };
  lastVideoElement = video;
  lastVideoContainer = container;
  lastMediaId = currentMediaId();
  updateOverlayParentForFullscreen();
}

/**
 * Fullscreen (medium finding): the overlay host is mounted on `<body>`, and in
 * native fullscreen only the element that requested it (usually the `<video>`'s
 * wrapper) is visible — so the panel and the subtitles disappeared exactly when
 * the user was using them. Moving the host INSIDE the fullscreen element keeps
 * everything on screen, and moving it back out restores the normal layout.
 *
 * The fullscreen element is a site element, so the host is re-parented, not
 * re-created: remounting React would cost the panel's state (the whole point
 * of watching in fullscreen).
 */
function updateOverlayParentForFullscreen(): void {
  if (!mount) return;
  const fullscreen =
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ??
    null;
  const entering = fullscreen !== null && !overlayRestore;
  const leaving = fullscreen === null && overlayRestore !== null;

  // Leaving: put back what the ENTRY changed, before the overlay moves home
  // again — restoring after the move would read a parent that is no longer
  // the one we wrote to.
  if (leaving) {
    const state = overlayRestore;
    overlayRestore = null;
    if (state && state.positionHost && state.positionHost.isConnected) {
      state.positionHost.style.position = state.positionWas;
    }
    // Focus does not survive a re-parent, and Windows drops it silently:
    // give back exactly the element that had it.
    if (state?.previousFocus?.isConnected) state.previousFocus.focus();
  }

  const target = fullscreen ?? document.body;
  if (mount.hostElement.parentElement === target) return;
  try {
    const previousParent = mount.hostElement.parentElement;
    // Record the state we are about to change ONCE per fullscreen session:
    // a second toggle inside the same session must not overwrite it, or the
    // original value is lost after two entries.
    if (entering) {
      const host = (fullscreen ?? document.body) as HTMLElement;
      overlayRestore = {
        positionHost:
          window.getComputedStyle(host).position === 'static' ? host : null,
        positionWas: host.style.position,
        // The focus goes through the video's controls on the way in, so this
        // has to be captured BEFORE the host moves.
        previousFocus: (document.activeElement as HTMLElement | null)?.isConnected
          ? (document.activeElement as HTMLElement | null)
          : null,
      };
    }
    const saved = overlayRestore;
    target.appendChild(mount.hostElement);
    // The entry branch wrote the override per session; leaving clears it.
    if (entering && saved?.positionHost) {
      saved.positionHost.style.position = 'relative';
    }
  } catch (err) {
    console.warn('[Kivara Lingo] could not re-parent the overlay for fullscreen', err);
  }
}

interface OverlayRestoreState {
  /** The node we forced `position: relative` on, when it was `static`. */
  positionHost: HTMLElement | null;
  /** Its `position` before we wrote ours. */
  positionWas: string;
  /** Element that had focus before the move — may be gone by then. */
  previousFocus: HTMLElement | null;
}

let overlayRestore: OverlayRestoreState | null = null;

function observeFullscreen(): void {
  document.addEventListener('fullscreenchange', updateOverlayParentForFullscreen);
  document.addEventListener('webkitfullscreenchange', updateOverlayParentForFullscreen);
}

async function init() {
  // Read the generation BEFORE waiting: a navigation during the wait
  // bumps it and this task must then be dropped, not mount the old video.
  const gen = readMountGen();
  const result = await waitForVideo();
  if (!result) {
    console.log('[Kivara Lingo] no <video> element on this page yet — staying idle');
    return;
  }
  const { video, container } = result;
  const adapter = await detectPlatform();
  // Enqueued: a navigation that fires while we waited for the video must
  // not mount in parallel (see enqueueMount).
  await enqueueMount(gen, () => mountFor(video, container, adapter));
}

function observeNavigation() {
  // YouTube SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(handleNavigation, 600);
  });

  // Generic SPA fallback: watch URL changes via popstate / pushState patching.
  // The patch itself used to be dispatched per call — YouTube pushes a few
  // times per navigation, so handleNavigation (which waits for a video, walks
  // the adapter and remounts) ran several times in parallel per click. One
  // leading-edge dispatch, plus a trailing one, keeps the invariant.
  const origPush = history.pushState;
  history.pushState = function (...args) {
    const result = origPush.apply(this, args);
    scheduleLocationChange();
    return result;
  };
  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    const result = origReplace.apply(this, args);
    scheduleLocationChange();
    return result;
  };
  window.addEventListener('popstate', scheduleLocationChange);
  window.addEventListener('kivara-locationchange', () => setTimeout(handleNavigation, 600));
}

/**
 * One dispatch per BURST of history calls.
 *
 * The previous version dispatched immediately on every call and scheduled an
 * extra trailing one, so three pushState calls produced four `handleNavigation`
 * runs (each of which waits for a video, re-detects the adapter and remounts).
 * Now the FIRST change of a burst sets a 250 ms window and only a change
 * arriving INSIDE that window produces exactly one more dispatch at the end —
 * so N calls in a burst = 1 event, and a genuinely new navigation right after
 * the window still gets its own leading dispatch.
 */
let bubbleWindow: number | null = null;
let sawLatestChange = false;
function scheduleLocationChange(): void {
  if (bubbleWindow == null) {
    dispatchLocationChange();
    bubbleWindow = window.setTimeout(() => {
      bubbleWindow = null;
      if (sawLatestChange) {
        sawLatestChange = false;
        dispatchLocationChange();
      }
    }, 250);
    return;
  }
  // Inside the window: replace the pending trailing dispatch.
  sawLatestChange = true;
}

function dispatchLocationChange(): void {
  window.dispatchEvent(new Event('kivara-locationchange'));
}

async function handleNavigation() {
  const gen = bumpMountGen(); // invalidate every pending queued mount
  const { video, container } = findVideoContainer();
  if (!video || !container) {
    await enqueueMount(gen, async () => unmount());
    return;
  }
  const adapter = await detectPlatform();
  await enqueueMount(gen, async () => {
    // Identity of the MEDIA, not of the element. YouTube keeps one <video>
    // per player and swaps its source on SPA navigation, so element identity
    // says "same video" while the user has moved to the next one. The URL is
    // what actually changed.
    const sameMedia =
      video === lastVideoElement &&
      container === lastVideoContainer &&
      lastMediaId === currentMediaId() &&
      !!mount;
    // The check must also survive the await above: `lastVideoElement` /
    // `mount` may have changed while earlier queued tasks ran, so the
    // decision is only final once it is this task's turn.
    if (sameMedia) return;
    // SPA navigated to a different video — drop any subtitle tracks the bus
    // cached from the previous one. Without this, the dual-caption lookup
    // would happily return cues from video A while we're watching video B
    // (timestamps may overlap by coincidence).
    clearBus();
    await mountFor(video, container, adapter);
  });
}

observeNavigation();
observeFullscreen();
void init().catch((err) => console.warn('[Kivara Lingo] init failed', err));
