# Hosted Accounts and GitHub Persistence

The user selected a hosted login/save service after considering HF Spaces. Deploy the existing interface and a Node backend together in a Docker Space owned by Rongjin03. Store user records in a separate private GitHub repository owned by RongjinGuo. The HF account already has PRO. CPU Basic has no hourly hardware charge; do not upgrade hardware. Space disk is ephemeral: only an acknowledged push to the private repository counts as a cloud save.

Use independent username/password accounts, with one administrator able to create user accounts and read their practice records. No public signup. Keep password hashes in the private repository; use a repository-scoped SSH deploy key for runtime Git access rather than an account-wide GitHub credential. Secrets stay outside public source and in Space Secrets. Connect to GitHub SSH through port 443, with pinned keys from the official GitHub metadata API.

Persist each user's validated existing state in `users/<username>/state.json`, wrapped as `{revision, updatedAt, state}`. The current state has settings, active, history (at most 30), and favorites. Whole-state optimistic concurrency is sufficient for a few users: stale revisions return 409 and preserve the local draft for explicit recovery. Never silently overwrite one device's state with another. Keep per-account local draft/outbox caches and batch cloud writes rather than committing every keystroke.

## Server contract

- `GET /api/health`: availability only; 200 after Git storage and account bootstrap succeed, otherwise 503.
- `GET /src/account-config.js`: `window.FinanceAccountConfig = {enabled:true};` in hosted mode. The static source defaults to disabled.
- `POST /api/login` body `{username,password}`: sets HttpOnly Secure SameSite=Lax cookie in HTTPS and returns `{user:{username,displayName,role}}`. Local HTTP is permitted only under explicit LOCAL_DEV on loopback. Same-origin writes only; rate-limit password attempts. Authentication sessions are memory-resident, expiring after 12 hours and revoked on logout/restart.
- `GET /api/session`: `{user}` or 401.
- `POST /api/logout`: revoke session, clear cookie.
- `GET /api/state`: `{revision,updatedAt,state}`; absent state is `{revision:0,updatedAt:null,state:null}`. Both state GET and PUT require `X-Finance-Account` matching the authenticated account; a cookie changed by another tab must never redirect an existing draft to a different user.
- `PUT /api/state` body `{revision,mutationId,state}`: validate the complete state, check revision, persist, return `{revision,updatedAt,state}`. A repeated mutation ID must be idempotent; a stale revision returns 409 with `{error, current:{revision,updatedAt,state}}`.
- `GET /api/admin/users`: `{users:[{username,displayName,role,createdAt}]}`; administrator only.
- `POST /api/admin/users` body `{username,displayName,password}`: create an ordinary user; username `[a-z0-9][a-z0-9_-]{2,31}`, password 12-128 characters; administrator only; never return hashes.
- `GET /api/admin/users/:username/state`: that user's state envelope; administrator only.

All APIs send no-store. Only explicit static assets are served; no source, environment, Git data, or private files. The application does not expose a client-supplied filesystem path. Static interview/offline exports continue to work without account scripts. HF-hosted pages use only same-origin account APIs. Baidu remains unconfigured while this account-based approach is implemented; previous Cloudflare records are retained.

## Git storage contract

`createGitStore({directory,remoteUrl,privateKey,knownHosts,authorName,authorEmail})` returns an object with asynchronous `init()`, `read(path)` (parsed JSON or null), and `update(path, updater, message)` (returns the updater's new JSON). Serialize writes, fetch current remote state before applying updates, reject invalid paths, commit only intended files, retry non-fast-forward pushes by reapplying the updater to the newest committed state, and return only after a successful push. Do not leave an unpushed commit as the basis for later successful reads. Local bare repositories must be supported for tests. Git command output must not disclose credentials.

Bootstrap accounts from `INITIAL_USERS_JSON` only when the private repository has no accounts. Each entry has username, displayName, role, and passwordHash; use Node scrypt with random salt. State schema validation reuses the existing question bank and session validator. No tokens or password values appear in logs.
