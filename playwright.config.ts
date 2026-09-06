import { defineConfig } from '@playwright/test';

/**
 * E2E config for the browser-loaded extension smoke tests.
 *
 * Scoped to `tests/e2e/**` so it never picks up the vitest unit suite. The
 * extension must be built first (`pnpm build`) — the fixture asserts that
 * `dist/manifest.json` exists and fails fast otherwise.
 *
 * Extensions require a Chromium persistent context, configured in
 * `tests/e2e/fixtures.ts`, so there is no `projects`/`use.browserName` here.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
