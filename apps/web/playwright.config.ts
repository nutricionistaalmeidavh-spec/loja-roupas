import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', {open:'never', outputFolder:'playwright-report'}]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @loja/api start',
      url: 'http://127.0.0.1:3000/v1/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 75_000,
    },
    {
      command: process.env.LOJA_E2E_BUILT === '1' ? 'pnpm --filter @loja/web preview' : 'pnpm --filter @loja/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 75_000,
    },
  ],
});
