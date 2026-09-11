const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/admin-browser',
  workers: 1,
  timeout: 30000,
  use: { browserName: 'chromium', channel: 'chrome', baseURL: 'http://127.0.0.1:8787', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'node scripts/setup-admin.mjs && node scripts/build-site.mjs && npx wrangler d1 migrations apply DB --local --persist-to .wrangler/admin-tests --config worker/wrangler.jsonc && npx wrangler dev --config worker/wrangler.jsonc --persist-to .wrangler/admin-tests --port 8787 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: false,
    timeout: 60000
  }
});
