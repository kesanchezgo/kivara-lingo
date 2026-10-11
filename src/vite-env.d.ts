/// <reference types="vite/client" />

// Build-time constant injected by vite.config.ts `define` (single version
// source: manifest.json). Declared here so `tsc --noEmit` accepts it.
declare const __APP_VERSION__: string;

// Injected by the `pcm-worklet-url` vite plugin: the hashed URL of the built
// AudioWorklet chunk (see `pcm-worklet.ts` and the plugin in vite.config.ts).
declare module 'virtual:__PCM_WORKLET_URL__' {
  const url: string;
  export default url;
}

// Build-time E2E flag. `KIVARA_E2E=1` compiles the e2e bridge page
// (src/e2e/index.html) and the matching door in the service worker into the
// bundle; any other build leaves it out entirely. Declared here so the
// tree-shaken `if (__E2E__)` block type-checks in both configurations.
declare const __E2E__: boolean;
