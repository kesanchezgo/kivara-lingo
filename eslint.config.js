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
    ignores: ['dist', 'node_modules', '.pnpm-store', 'tests/e2e/**'],
  },
];
