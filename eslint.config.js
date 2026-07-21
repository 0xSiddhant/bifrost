import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'server/drizzle/**', 'storage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        { type: 'server-core', pattern: 'server/src/core' },
        { type: 'server-module', pattern: 'server/src/modules/*', capture: ['module'] },
        { type: 'client-core', pattern: 'client/src/core' },
        { type: 'client-feature', pattern: 'client/src/features/*', capture: ['feature'] },
        { type: 'client-app', pattern: 'client/src/app' },
      ],
      // Composition roots are single files, so they are classified as file
      // categories rather than folder elements.
      'boundaries/files': [
        { category: 'server-app', pattern: 'server/src/app.ts' },
        { category: 'client-entry', pattern: 'client/src/main.tsx' },
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',
      // The three modularization rules, mechanically enforced:
      //   core never imports modules; modules never import each other (bus only);
      //   composition roots (app) may import everything.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'server-core' } },
              allow: { to: { element: { type: 'server-core' } } },
            },
            {
              from: { element: { type: 'server-module' } },
              allow: {
                to: {
                  element: [
                    { type: 'server-core' },
                    {
                      type: 'server-module',
                      captured: { module: '{{from.element.captured.module}}' },
                    },
                  ],
                },
              },
            },
            {
              from: { file: { categories: 'server-app' } },
              allow: { to: { element: { type: '(server-core|server-module)' } } },
            },
            {
              from: { file: { categories: 'client-entry' } },
              allow: { to: { element: { type: '(client-core|client-app)' } } },
            },
            {
              from: { element: { type: 'client-core' } },
              allow: { to: { element: { type: 'client-core' } } },
            },
            {
              from: { element: { type: 'client-feature' } },
              allow: {
                to: {
                  element: [
                    { type: 'client-core' },
                    {
                      type: 'client-feature',
                      captured: { feature: '{{from.element.captured.feature}}' },
                    },
                  ],
                },
              },
            },
            {
              from: { element: { type: 'client-app' } },
              allow: { to: { element: { type: '(client-core|client-feature|client-app)' } } },
            },
            // Composition roots and entry files may be imported by tests/tooling.
            {
              allow: { to: { file: { categories: '(server-app|client-entry)' } } },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'scripts/**', 'server/drizzle.config.ts', 'client/vite.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  {
    // CommonJS config files (PM2's ecosystem.config.cjs) — Node globals.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly', process: 'readonly' },
    },
  },
  prettier,
);
