# Invite Login Implementation Plan

**Goal:** Use the two user-specified invitation codes to access the existing administrator and practice records.

**Architecture:** Keep account identity and Git persistence; change only authentication credentials and their UI. Store HMAC-SHA256 invitation hashes in private accounts and a separate secret in HF Secrets.

- [x] Confirm existing account identities and define the invitation-only API without publishing live codes.
- [x] Update `server/auth.mjs`, `server/validation.mjs`, `server/http.mjs`, `server/main.mjs` and API regression tests for code matching, uniqueness, leading zeros, and bounded guesses.
- [x] Update `src/accounts.js`, account styling, and Chrome fixture checks to use one invite field and administrator code creation.
- [x] Update the real Git browser fixture and both integration specs; verify existing record and tab-isolation behavior.
- [x] Update user/deployment documentation and private login instructions.
- [x] Build and scan the public package; provision `INVITE_CODE_SECRET`, publish code, migrate hashes while preserving existing private records, then restart to reload cache.
- [x] Verify both live invitation codes, expected privileges, original state, and a save/read cycle; publish source after checks pass.

Verification: the unit/Git/package suite passed, final invitation API suite passed 25 tests, account UI/sync suite passed 13 tests, and all 6 real Git browser tests passed. Live HF commit `0227d48878e087f41e38a82d718780e406fc4804` accepts the confirmed practice/admin invitations. Actual Chrome login, leading-zero retention, permission separation, existing-record preservation, Git save, and fresh-browser read passed after migration and cache reload. Live code values remain outside public source.
