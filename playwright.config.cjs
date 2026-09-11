const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { browserName: 'chromium', channel: 'chrome', baseURL: 'http://127.0.0.1:43188', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/serve.mjs', env: { PORT: '43188' }, url: 'http://127.0.0.1:43188', reuseExistingServer: false }
});
