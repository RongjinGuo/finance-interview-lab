# Cloud Visitor Admin Implementation Plan

**Goal:** Publish the interview frontend on GitHub Pages and deploy a protected Cloudflare Worker/D1 visitor dashboard.

**Architecture:** Static public interview pages report one pathname per document load to a separate Worker. Cloudflare-derived IP/geolocation and D1 storage; administrator cookies remain on the Worker origin.

**Tech Stack:** Vanilla JS, Cloudflare Workers/D1, GitHub Actions, Node tests, Playwright.

- [x] Implement and verify constrained visit reporting with offline mode disabled.
- [x] Implement IP/geolocation handling, D1 schema, authenticated APIs, limits and retention.
- [x] Implement responsive login, statistics, filters, CSV and logout.
- [x] Keep credentials outside source and explicitly restrict published assets.
- [x] Pass 79 unit/endpoint tests, 9 original interview browser scenarios and 2 real Wrangler admin browser scenarios.
- [x] Independently review security and inspect desktop/mobile admin screenshots.
- [x] Publish and verify GitHub Pages at https://rongjinguo.github.io/finance-interview-lab/.
- [x] Complete user Cloudflare authorization, provision D1 and deploy Worker with secrets.
- [ ] Configure real backend endpoint in published frontend and verify a live visit appears in the protected dashboard.

The previous Node server-only visitor plan is superseded. Public interface has no visit notice, per the user's explicit instruction. Cloudflare authorization is required for the last two deployment steps.
