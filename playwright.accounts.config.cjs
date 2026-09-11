const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/accounts-integration',
  workers: 1,
  timeout: 60000,
  use: { browserName: 'chromium', channel: 'chrome', baseURL: 'http://127.0.0.1:43189', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/serve-accounts-test.mjs', url: 'http://127.0.0.1:43189/api/health', reuseExistingServer: false, timeout: 60000 }
});
