import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.MZ_E2E_PORT ?? 8799);
const iphone = devices['iPhone 15'];

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'iphone',
      use: { ...iphone, browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
    {
      name: 'desktop',
      testMatch: /smoke\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
      dependencies: ['iphone'],
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
