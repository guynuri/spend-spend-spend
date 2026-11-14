import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';
import globals from 'globals';

const dbRestriction = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/db/global', '**/db/global.ts'],
          message: 'db/global.ts is only for auth/admin routes, middleware, seed and db/** (PLAN §6).',
        },
      ],
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "MemberExpression[property.name='DB']",
      message: 'env.DB may only be used under src/server/db/** (and auth/admin/middleware/seed). Use tenantDb.',
    },
    {
      selector: "Identifier[name='D1Database']",
      message: 'D1Database may only be referenced under src/server/db/** (and auth/admin/middleware/seed).',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', '.wrangler', 'worker-configuration.d.ts', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, i18next },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': { include: ['^(aria-label|title|placeholder|alt)$'] },
          callees: { exclude: ['^(t|i18n\\.t|useTranslation|Trans)$'] },
        },
      ],
    },
  },
  {
    files: ['src/server/routes/**/*.ts', 'src/server/ai/**/*.ts', 'src/server/index.ts', 'src/shared/**/*.ts', 'src/client/**/*.{ts,tsx}'],
    ignores: ['src/server/routes/auth.ts', 'src/server/routes/admin.ts'],
    rules: dbRestriction,
  },
  {
    files: ['scripts/**', 'tests/**', 'e2e/**', '*.config.*'],
    rules: { 'no-console': 'off' },
  },
);
