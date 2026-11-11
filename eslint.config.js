import reactHooksPlugin from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooksPlugin,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // The hooks rules the review asked for. `exhaustive-deps` stays a
      // warning by decision (the CI job pins the count with --max-warnings,
      // so it can only go down); `rules-of-hooks` is an ERROR because a
      // conditional hook is a real bug, not a style question, and it is the
      // rule that would have caught the audit's #13 the first time.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      // The tseslint rules are listed at `off` because:
      //  (a) ~20 existing `eslint-disable-next-line
      //      @typescript-eslint/no-explicit-any` comments (written
      //      before tseslint was in the tree) resolve to "rule not
      //      found" — hard errors — unless the plugin IS loaded.
      //  (b) the rules being ABLE to resolve is enough to make those
      //      comments valid again; turning them on would mean touching
      //      ~27 call sites across src/, out of scope for this audit.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    // Same parser and the hook rules for the tests and the build scripts:
    // a hook called conditionally inside a test helper is the same bug, and
    // `tests/` used to be entirely unlinted.
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'scripts/**/*.{ts,mts,cjs,mjs}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    // D6/H7: F9 retired lucide-react. The icon set is the Phosphor layer in
    // src/ui/icons.tsx, and the ban is repo-wide (not just the ported tree) so
    // a stray import has nowhere to hide. Declared BEFORE the content/app/ui
    // guard: flat config replaces `no-restricted-imports` options when two
    // matching blocks set the rule, so that block repeats this pattern.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/icons.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['lucide-react'],
              message: 'D6: import icons from src/ui/icons.tsx (Phosphor), not lucide-react.',
            },
          ],
        },
      ],
    },
  },
  /**
   * v2 architecture guards (docs/REDESIGN-V2.md §3 H1, H2, H5, H7).
   *
   * These are ERRORs on purpose: each one is a defect the redesign would
   * otherwise reintroduce silently, and each has a phase that removes the
   * exception list below.
   */
  {
    files: ['src/content/**/*.{ts,tsx}', 'src/app/components/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
    ignores: [
      // H5 exception: the Yomitan module owns IndexedDB reads/writes and is
      // reached only from extension contexts — the service worker
      // (service-worker.ts, resolve-word.ts, enrichment/sources/), the
      // onboarding page, and type-only from src/ui/ports. A content script
      // cannot import it: the panel parses through yomitan-parse.ts (pure)
      // and content/nlp/dict-import-client.ts ships the rows to the worker.
      'src/content/nlp/yomitan.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/shared/db', '**/shared/db/*', './db', '../db'],
              message:
                'H5: in a content script, IndexedDB is the SITE database, not ours. Reach the data through a message to the service worker.',
            },
            {
              group: ['@radix-ui/*'],
              message:
                'H1: Radix focus scopes and dismissable layers read document.activeElement/document listeners, which break inside our CLOSED shadow root. Use the primitives in src/ui/primitives.',
            },
            {
              group: ['lucide-react'],
              message: 'D6: import icons from src/ui/icons.tsx (Phosphor), not lucide-react.',
            },
          ],
        },
      ],
    },
  },
  {
    // H2: seeking must go through the platform PlaybackController. F6 removed
    // the last two exceptions (capture/frame.ts and ui/App.tsx), so the rule
    // now applies to every content module outside platform-adapters/**.
    files: ['src/content/**/*.{ts,tsx}'],
    ignores: ['src/content/platform-adapters/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='currentTime']",
          message:
            "H2: writing video.currentTime directly interrupts playback on Netflix (M7375). Go through the platform's PlaybackController.",
        },
      ],
    },
  },
  {
    ignores: ['dist', 'node_modules', '.pnpm-store', 'tests/e2e/**'],
  },
];
