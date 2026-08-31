import { defineConfig } from 'vitest/config';
import path from 'path';

/** Opt-in configuration for network-dependent enrichment probes. */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    // Node uses the same unrestricted fetch model as the direct source
    // audit. happy-dom applies browser CORS, which is not representative
    // of the extension service worker's declared host permissions.
    environment: 'node',
    include: ['tests/probes/**/*.probe.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 12000,
  },
});
