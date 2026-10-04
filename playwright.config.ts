import { defineConfig, devices } from '@playwright/test';

/** E2E runs against the running stack (ops.ps1 start, or the CI compose job). */
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8105', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
      testMatch: /flows\.spec\.ts/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    {
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
});
