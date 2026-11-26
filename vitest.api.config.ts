import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        main: './src/server/index.ts',
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BOOTSTRAP_TOKEN: 'test-bootstrap-token',
            AI_PROVIDER: 'mock',
            SHORTCUT_CHECK: 'skip',
          },
        },
      }),
    ],
    test: {
      name: 'api',
      include: ['tests/api/**/*.test.ts'],
      setupFiles: ['./tests/api/setup.ts'],
    },
  };
});
