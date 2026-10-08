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
}

let mount: Mount | null = null;
let lastVideoElement: HTMLVideoElement | null = null;
let lastVideoContainer: HTMLElement | null = null;

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
  };
  lastVideoElement = video;
  lastVideoContainer = container;
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

  // Generic SPA fallback: watch URL changes via popstate / pushState patching
  const origPush = history.pushState;
  history.pushState = function (...args) {
    const result = origPush.apply(this, args);
    window.dispatchEvent(new Event('kivara-locationchange'));
    return result;
  };
  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    const result = origReplace.apply(this, args);
    window.dispatchEvent(new Event('kivara-locationchange'));
    return result;
  };
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('kivara-locationchange')));
  window.addEventListener('kivara-locationchange', () => setTimeout(handleNavigation, 600));
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
    // Re-checked INSIDE the queue: `lastVideoElement` / `mount` may have
    // changed while earlier queued tasks ran, so the decision can only be
    // made once it is this task's turn.
    if (video === lastVideoElement && container === lastVideoContainer && mount) return;
    // SPA navigated to a different video — drop any subtitle tracks the bus
    // cached from the previous one. Without this, the dual-caption lookup
    // would happily return cues from video A while we're watching video B
    // (timestamps may overlap by coincidence).
    clearBus();
    await mountFor(video, container, adapter);
  });
}

observeNavigation();
void init().catch((err) => console.warn('[Kivara Lingo] init failed', err));
