import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'backups/**',
      'data/**',
      'animation/out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/cli.ts', 'scripts/**/*.{js,mjs}', 'tests/**/*.ts', 'animation/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // Product film sources: classic browser scripts sharing the Motion global.
    files: ['animation/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, Motion: 'writable' } },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
