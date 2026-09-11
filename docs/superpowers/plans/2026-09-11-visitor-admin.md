# Visitor Admin Implementation Plan

**Goal:** Make IP visit records and approximate locations available in a protected admin dashboard.

**Architecture:** Existing Node app gains SQLite visit storage and cookie-authenticated JSON APIs. Offline geo-IP lookup. Separate admin frontend shares existing visual language.

**Tech Stack:** Node 24+ built-in SQLite, geoip-lite, proxy-addr, vanilla HTML/CSS/JS, Node test runner and Playwright.

- [x] Inspect existing server and define request/response contracts and logging scope.
- [ ] Implement and test analytics persistence, trusted proxy IP resolution, filtering/retention and CSV exports.
- [ ] Implement and test authenticated HTTP service, protected files, rate limits and origin checks.
- [ ] Implement admin login, metrics, searchable visit table, pagination and export.
- [ ] Integrate startup/deployment, add visit notice and explain local versus public IP visibility.
- [ ] Verify end-to-end behavior and original interview flows; inspect admin on desktop/mobile; deliver local admin and deployment instructions.
