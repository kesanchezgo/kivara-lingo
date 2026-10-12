import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Build-time constants source modules read at module scope. The browser
  // bundle gets these from vite.config.ts define; without them here,
  // importing a module that reads a flag under vitest throws on an
  // unresolvable identifier.
  define: {
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
    // Report an unhandled rejection against a file instead of swallowing it.
    //
    // Left at the default (false) on purpose: it was set to true during a round
    // that wanted shuffle-only flakes to stop failing, and that made a real
    // defect unfalsifiable — Vitest attributes the rejection to whichever task
    // was running when the rejection surfaced, so the file named in the report
    // was never the file that left the promise dangling. See the long note in
    // tests/setup.ts. Reading `unhandledErrors` in the JSON reporter gives the
    // real stack.
    dangerouslyIgnoreUnhandledErrors: false,
  },
});
