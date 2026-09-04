import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests run the real extension against a real Worker.
 *
 * The Worker is `wrangler dev` with a locally generated signing key, so the
 * Access check is exercised for real rather than stubbed - the extension has no
 * way to tell this apart from the deployed hub, which is the point.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The extension has one connection and one hub; running specs in parallel
  // would have them writing over each other's state.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:3011',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Branded Chrome 137 and later refuses --load-extension, so these tests
      // only ever run against the bundled Chromium - and only with a real
      // browser window: the headless shell Playwright uses by default cannot
      // load an extension at all, and silently behaves as if none were there.
      use: { channel: 'chromium', headless: false },
    },
  ],
  webServer: {
    command: 'pnpm dev:worker',
    url: 'http://localhost:3011/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The Worker answers this with a 401 until a key is presented, which is
    // proof enough that it is up and checking.
    ignoreHTTPSErrors: true,
  },
})
