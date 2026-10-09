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
          if (id.includes('lamejs')) return 'offscreen';
        },
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})

