# Hosted Account Sync Plan

**Goal:** Deploy username/password login and GitHub-backed answer persistence on Hugging Face Spaces.

**Architecture:** Same-origin Node backend and current frontend on HF CPU Basic; one private Git repository stores hashed accounts and versioned user state. A write deploy key restricts runtime access to that repository.

- [x] Confirm HF authorization, PRO eligibility, and absence of an existing interview Space.
- [x] Implement and test serialized, conflict-aware Git storage (`server/git-store.mjs`, `tests/git-store.test.cjs`).
- [x] Implement and test authentication, authorization, validation, and state APIs (`server/http.mjs`, `server/main.mjs`, `tests/accounts-api.test.cjs`).
- [x] Implement login, per-account local drafts, cloud synchronization/conflict recovery, and administrator record viewing (`src/accounts.js`, `src/app.js`, `src/account.css`).
- [x] Integrate hosted configuration, Docker packaging, build/offline behavior, and deployment documentation.
- [x] Provision private data repository with a scoped deploy key and bootstrap admin/user credentials outside source.
- [x] Run unit/API and browser checks including account separation, cross-browser restore, logout, conflicts, and storage failure.
- [x] Deploy the Space with runtime secrets and verify actual remote writes and reload persistence.
- [ ] Verify phone access and save/read behavior; provide the new website and local login instructions.

Server/API and UI workers share the spec contract; root owns provisioning, packaging, index/build integration, end-to-end checks, and deployment. Prior Baidu setup remains pending and must not be reported as active.

Verified on 2026-09-11: 123 unit/API/Git/package tests, 13 account sync/UI tests, 6 real Git account browser tests, and 9 existing browser tests passed. HF source commit `a97a5295e4ddcb547f6c357d697bd88a25e6856d` runs on CPU Basic. Real HTTPS login/save, independent private-Git read, second-browser restore, administrator answer viewing, and post-Space-restart recovery passed. Phone-network reachability awaits the user's direct-device check.
