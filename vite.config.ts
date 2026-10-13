import { defineConfig } from 'vite'
import path from 'path'
import fsSync from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

/**
 * `_locales/` is not an entry point, so nothing in the graph pulls it into
 * dist/ — Chrome then reads the name/description/command strings as literal
 * "__MSG_…__". Copy the folder verbatim into the build output.
 */
function copyLocalesPlugin() {
  return {
    name: 'kivara-copy-locales',
    apply: 'build' as const,
    closeBundle() {
      const from = path.resolve(__dirname, '_locales');
      const to = path.resolve(__dirname, 'dist/_locales');
      fsSync.cpSync(from, to, { recursive: true });
    },
  };
}

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
 * `input.pcm-worklet` below), and the hash is not known until the bundle has
 * been generated — so reading `dist/` to guess it, which is what this used to
 * do, resolves to the PREVIOUS build's chunk name. dist is not emptied between
 * builds, so that stale file usually still exists: `addModule` loads an older
 * copy of the processor, and a change to the worklet source silently does not
 * take effect (that is how a broken processor kept looking fine for a whole
 * round). On the first build, when there is no previous chunk at all, the
 * guessed name does not exist, `addModule` rejects, and capture silently
 * degrades to the ScriptProcessor fallback.
 *
 * So the URL is a placeholder until the bundle exists: this plugin emits one,
 * then rewrites the placeholder in the generated chunks with the name of the
 * chunk that actually registered `pcm-capture`. A build that fails to emit the
 * worklet leaves the placeholder standing, and `pcm-worklet.test.ts` fails on
 * it.
 */
function workletUrlPlugin() {
  /** Rewritten, after `generateBundle`, in every chunk that carries it. */
  const placeholder = '/__PCM_WORKLET_URL__';
  let cache: string | undefined;
  return {
    name: 'pcm-worklet-url',
    resolveId(source: string) {
      if (source === 'virtual:__PCM_WORKLET_URL__') return source;
      return null;
    },
    load(id: string) {
      if (id !== 'virtual:__PCM_WORKLET_URL__') return null;
      return `export default ${JSON.stringify(placeholder)}`;
    },
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
      cache = undefined;
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !/pcm-worklet.*\.js$/.test(fileName)) continue;
        cache = cache ?? fileName;
      }
      if (!cache) throw new Error('pcm-worklet-url: no pcm-worklet chunk was emitted');
      // The bundle key is relative to the output root (`assets/pcm-worklet-h.js`),
      // so normalise to a root-absolute URL — `/assets/assets/…` does not exist,
      // and addModule reports that as a bare AbortError.
      const url = cache.startsWith('/') ? cache : `/${cache}`;
      cache = url;
      // The placeholder may have been inlined into any chunk that imported
      // the virtual module, so rewrite every chunk that still carries it.
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.code?.includes(placeholder)) continue;
        chunk.code = chunk.code.split(placeholder).join(cache);
      }
    },
  };
}

export default defineConfig({
  define: {
    // Single version source: manifest.json. Popup/options read it at build
    // time instead of hardcoding "v0.2", so the three can never drift.
    __APP_VERSION__: JSON.stringify(manifest.version),
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
     * (the fallback swallows the error). The placeholder is filled in from the
     * generated bundle itself, so what ships is always the name of the chunk
     * in that same build — see `workletUrlPlugin`.
     */
    workletUrlPlugin(),
    copyLocalesPlugin(),
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

