import { defineConfig } from 'vite'
import path from 'path'
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

export default defineConfig({
  define: {
    // Single version source: manifest.json. Popup/options read it at build
    // time instead of hardcoding "v0.2", so the three can never drift.
    __APP_VERSION__: JSON.stringify(manifest.version),
    // Build-time ASR flag. ASR is off by default: the Whisper glue cannot
    // load under MV3's CSP unless it ships INSIDE the extension.
    // `KIVARA_WHISPER=1 pnpm build` flips it on (see shared/whisper-flag.ts).
    __KIVARA_WHISPER__: JSON.stringify(process.env.KIVARA_WHISPER === '1'),
  },
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
    crx({ manifest }),
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

