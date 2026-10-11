import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Build-time constants source modules read at module scope. The browser
  // bundle gets these from vite.config.ts define; without them here,
  // importing a module that reads whisper-flag under vitest throws on an
  // unresolvable identifier.
  define: {
    __KIVARA_WHISPER__: JSON.stringify(process.env.KIVARA_WHISPER === '1'),
    // The E2E bridge compiles into the service worker ONLY when this is true
    // (see vite.config.ts). Vitest needs the same source of truth — a test
    // that imports the real service worker must see the same constants the
    // browser bundle does, or importing the worker throws on an unresolvable
    // identifier.
    __E2E__: JSON.stringify(process.env.KIVARA_E2E === '1'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // Playwright owns the browser E2E suite under tests/e2e (its own `.spec.ts`
    // files + persistent-context config). Keep them out of the vitest run so
    // `vitest` and `playwright test` never fight over the same files.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['tests/setup.ts'],
  },
});
