/// <reference types="vite/client" />

// Build-time constant injected by vite.config.ts `define` (single version
// source: manifest.json). Declared here so `tsc --noEmit` accepts it.
declare const __APP_VERSION__: string;
