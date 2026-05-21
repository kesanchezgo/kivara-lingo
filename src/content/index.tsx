import { createRoot, type Root } from 'react-dom/client';
import { ShadowHost } from './shadow-host';
import { detectPlatform } from './platform-adapters';
import { App } from './ui/App';
import type { SubtitleSource } from './platform-adapters/types';
import { useKivaraStore } from '../shared/store';

console.log('[Kivara Lingo] content script injected on', window.location.hostname);

// Sync the user's configured source language to a DOM attribute so the
// MAIN-world interceptor (which can't access chrome.storage or the Zustand
// store) can read it and rewrite YouTube's timedtext lang parameter.
function syncSourceLangToDOM() {
  const lang = useKivaraStore.getState().translate.sourceLang || 'en';
  document.documentElement.setAttribute('data-kivara-source-lang', lang);
}
syncSourceLangToDOM();
useKivaraStore.subscribe((state, prev) => {
  if (state.translate.sourceLang !== prev.translate.sourceLang) {
    syncSourceLangToDOM();
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
  const result = await waitForVideo();
  if (!result) {
    console.log('[Kivara Lingo] no <video> element on this page yet — staying idle');
    return;
  }
  const { video, container } = result;
  const adapter = await detectPlatform();
  await mountFor(video, container, adapter);
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
  const { video, container } = findVideoContainer();
  if (!video || !container) {
    unmount();
    return;
  }
  if (video === lastVideoElement && container === lastVideoContainer && mount) return;
  const adapter = await detectPlatform();
  await mountFor(video, container, adapter);
}

observeNavigation();
void init();
