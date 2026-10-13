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
      // The ONLY active rule the review asked for. The tseslint rules
      // are listed at `off` because:
      //  (a) ~20 existing `eslint-disable-next-line
      //      @typescript-eslint/no-explicit-any` comments (written
      //      before tseslint was in the tree) resolve to "rule not
      //      found" — hard errors — unless the plugin IS loaded.
      //  (b) the rules being ABLE to resolve is enough to make those
      //      comments valid again; turning them on would mean touching
      //      ~27 call sites across src/, out of scope for this audit.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    ignores: ['dist', 'node_modules', '.pnpm-store', 'tests/e2e/**'],
  },
];
