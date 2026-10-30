import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real stack: Vite dev server -> API -> MongoDB.
 * The API uses an isolated database (taskmanager_e2e) and relaxed auth rate
 * limits so repeated sign-ups from one IP do not trip the limiter.
 */
const E2E_DB = process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/taskmanager_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npx tsx ../api/src/server.ts',
      url: 'http://localhost:4100/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: '4100',
        MONGODB_URI: E2E_DB,
        REDIS_URL: process.env.E2E_REDIS_URL ?? '',
        WEB_ORIGIN: 'http://localhost:5174',
        ACCESS_TOKEN_SECRET: 'e2e-access-token-signing-key-0123456789abcdef',
        COOKIE_SECRET: 'e2e-cookie-signing-key-0123456789abcdef-zyxw',
        AUTH_RATE_LIMIT_MAX: '1000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: 'http://localhost:4100' },
    },
  ],
});
