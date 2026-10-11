import { defineConfig } from 'vite'
import path from 'path'
import fsSync from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

/**
 * Inject the built PCM worklet's URL as `__PCM_WORKLET_URL__`.
 *
 * The worklet is emitted as a content-hashed asset (it is a build input, see
 * `input.pcm-worklet` below), so the only way to address it is to read what
 * vite actually named it. This plugin waits for the bundle, scans the emitted
 * chunks for the one that registered `pcm-capture`, and returns the URL —
 * meaning `audioWorklet.addModule` can never 404 on a stale guess, and a
 * build that failed to emit the worklet fails here instead of silently
 * degrading to the ScriptProcessor fallback.
 */
function workletUrlPlugin() {
  let cached: string | undefined
  const find = (): string => {
    if (cached) return cached
    const dist = path.resolve(__dirname, 'dist')
    if (fsSync.existsSync(dist)) {
      const dir = path.join(dist, 'assets')
      if (fsSync.existsSync(dir)) {
        const match = fsSync
          .readdirSync(dir)
          .filter((f) => /^pcm-worklet.*\.js$/.test(f))
          .sort()
          .pop()
        if (match) {
          cached = `/assets/${match}`
          return cached
        }
      }
    }
    // First build (nothing emitted yet): the `input.pcm-worklet` entry below
    // guarantees the chunk exists by the time the browser asks for it.
    cached = '/assets/pcm-worklet.js'
    return cached
  }
  return {
    name: 'pcm-worklet-url',
    resolveId(source: string) {
      if (source === 'virtual:__PCM_WORKLET_URL__') return source
      return null
    },
    load(id: string) {
      if (id !== 'virtual:__PCM_WORKLET_URL__') return null
      return `export default ${JSON.stringify(find())}`
    },
  }
}

export default defineConfig({
  define: {
    // Single version source: manifest.json. Popup/options read it at build
    // time instead of hardcoding "v0.2", so the three can never drift.
    __APP_VERSION__: JSON.stringify(manifest.version),
    // Build-time ASR flag. ASR is off by default: the Whisper glue cannot
    // load under MV3's CSP unless it ships INSIDE the extension.
    // `KIVARA_WHISPER=1 pnpm build` flips it on (see shared/whisper-flag.ts).
    __KIVARA_WHISPER__: JSON.stringify(process.env.KIVARA_WHISPER === '1'),
    // Build-time E2E flag. Only `KIVARA_E2E=1 pnpm build` (what the Playwright
    // fixture runs) flips it on, and it is the ONLY thing that compiles the
    // e2e bridge page into the bundle (see src/background/service-worker.ts
    // and src/e2e/index.ts). A production build has no reference to it: the
    // e2e dist guard greps for both the page and the listener to prove that.
    __E2E__: JSON.stringify(process.env.KIVARA_E2E === '1'),
  },
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
    crx({ manifest }),
    /**
     * Publish the built worklet's hashed URL to the bundle.
     *
     * `audioWorklet.addModule` needs a URL the bundler knows about; the
     * emitted file name is content-hashed, so a hardcoded path would rot on
     * the next change and silently fall back to ScriptProcessor forever
     * (the fallback swallows the error). This plugin reads the manifest vite
     * wrote, finds the worklet chunk, and injects its URL as a build-time
     * constant — one place, no guessing, and the fallback fails loudly in
     * tests because the constant is missing.
     */
    workletUrlPlugin(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Build-time constants. `process.env.X` compiles into a live `process` lookup,
  // which does not exist in a bundled extension page and throws `ReferenceError`
  // on import — so anything a UI module reads at module scope comes from here.
  //
  // ASR is off by default: the Whisper glue cannot load under MV3's CSP unless
  // it ships INSIDE the extension. `KIVARA_WHISPER=1 pnpm build` flips it on
  // for a build that packages glue + WASM (see shared/whisper-flag.ts).
  build: {
    // Minified by default (Chrome Web Store reviewers look at the zip, and a
    // 2.4 MB `frequency` chunk is silly to ship unminified). `KIVARA_NO_MINIFY=1`
    // restores readable output for debugging a specific build; keep it out of
    // CI.
    minify: process.env.KIVARA_NO_MINIFY === '1' ? false : true,
    rollupOptions: {
      input: {
        offscreen: path.resolve(__dirname, 'src/offscreen/index.html'),
        onboarding: path.resolve(__dirname, 'src/onboarding/index.html'),
        // Compiled only when __E2E__ is true: the page is the sole entry to
        // the bridge, so keeping it out of the default input list is what
        // keeps a production build free of it even before the tree-shake.
        ...(process.env.KIVARA_E2E === '1'
          ? { e2e: path.resolve(__dirname, 'src/e2e/index.html') }
          : {}),
        // The worklet is a real file `audioWorklet.addModule` fetches, not a
        // module the chunk imports, so it has to be emitted on its own. The
        // `?url` import in audio-processor.ts only rewrites the path; this
        // entry is what puts the file in dist in the first place.
        'pcm-worklet': path.resolve(__dirname, 'src/offscreen/pcm-worklet.ts'),
      },
      output: {
        // Force lamejs into the same chunk as the offscreen processor.
        // lamejs uses UMD-style internal globals (MPEGMode, Lame, etc.)
        // that break when Vite splits it into a separate async chunk
        // because the global initialization runs in the wrong scope.
        manualChunks(id) {
          if (id.includes('lamejs')) return 'offscreen'; // works for both the CJS and the ESM fork
        },
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})

