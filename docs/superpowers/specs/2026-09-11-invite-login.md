# Invite Login

Replace the hosted username/password form with one reusable numeric invitation code. The user's first code belongs to the existing practice account; the second belongs to the existing administrator, as explicitly confirmed by the user. Keep usernames, answer documents, local drafts, roles, and expected-account request binding unchanged. Live code values belong only in local private instructions and server-side keyed hashes, never public source or examples.

`POST /api/login` accepts only `{inviteCode: string}`. Accept 4-12 ASCII digits without numeric conversion so leading zeros remain meaningful. A server-only `INVITE_CODE_SECRET` (at least 32 characters) keys HMAC-SHA256; `accounts.json` stores `inviteCodeHash` per user. Legacy password hashes remain readable during migration but cannot authenticate. Duplicate invitation hashes are invalid. Guess limits apply across different submitted codes.

Administrator creation changes to `{username, displayName, inviteCode}` and creates ordinary users only. Existing cookies, same-origin enforcement, account-bound state requests, Git persistence, conflict recovery, and draft isolation remain in use. The login screen has no username/password controls and explains that the same invitation reopens the same practice records.

Deploy updated code before adding invitation hashes to existing accounts, because the previous strict account validator does not accept the new field. Provision the server secret first; migrate with one private Git update that preserves every existing user and answer document. Refresh cached accounts after migration with a Space restart. Validate both roles, leading-zero handling, answer persistence, duplicate rejection, and prior-password rejection.
