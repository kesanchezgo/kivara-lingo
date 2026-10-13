import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Build-time constants source modules read at module scope. The browser
  // bundle gets these from vite.config.ts define; without them here,
  // importing a module that reads a flag under vitest throws on an
  // unresolvable identifier.
  define: {
    __E2E__: JSON.stringify(process.env.KIVARA_E2E === '1'),
    // Same value as vite.config.ts, for Popup/options imports under vitest.
    __APP_VERSION__: JSON.stringify('test'),
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
    // tests/setup.ts. Reading `unhandledRejection` (JSON reporter) gives the
    // real stack.
    dangerouslyIgnoreUnhandledErrors: false,
    // LEAKS GOODBYE: the previous test's stubs and mocks must not bleed into
    // the next test's view of the world. The reviewer's explicit request —
    // a previous round leaked `fetch` stubs across files.
    //
    // Three separate leashes, because they cover three different shapes:
    //  • `restoreMocks` re-wraps `vi.spyOn` (calls `mockRestore`) but does
    //    NOT touch a bare `vi.fn()`, whose calls persist;
    //  • `clearMocks` empties calls AND implementations of every `vi.fn`
    //    between tests — the piece `restoreMocks` misses;
    //  • `unstubGlobals` removes `vi.stubGlobal` substitutions and their
    //    requestAnimationFrames.
    // Together they mean "each test starts from a clean slate" whether the
    // previous test used a spy, a mock or a global stub.
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,
  },
});
