# GitHub Pages and Cloudflare visitor administration

User accepted GitHub Pages frontend + Cloudflare Workers/D1 visit service, and explicitly requests no visitor-recording notice on the public page. Public interface stays visually unchanged. Interview answers remain browser-local; the website records one visit per document load only after deployment configuration exists. Offline HTML never sends telemetry.

The Node server-only design is superseded. GitHub is authenticated as RongjinGuo, whose Pages base is https://rongjinguo.github.io/. Use a new finance-interview-lab project repository. Backend Worker finance-interview-visits hosts its own protected admin UI and same-origin admin API. Its separate /api/visit route accepts the allowed frontend Origin and its pathname, derives visitor IP from Cloudflare's trusted cf-connecting-ip header and approximate location from request.cf. It never accepts a client-supplied IP. CORS allows only the configured frontend Origin. Page paths are constrained by SITE_PATH_PREFIX. Do not store answers, query parameters or full referrers.

## Contracts

- worker/index.mjs default {fetch,scheduled}. Bindings DB (D1), ASSETS; env ALLOWED_ORIGIN, SITE_PATH_PREFIX, ADMIN_PASSWORD_HASH (salt:hex PBKDF2 SHA256 iterations 100000; root generates), SESSION_SECRET (random secret), RETENTION_DAYS default90. Optional LOCAL_DEV=true allows missing CF header to classify 127.0.0.1 local; never production arbitrary X-Forwarded-For.
- POST /api/visit with JSON {path}, exact allowed Origin, size<=2048, normalized safe path, returns 204 and CORS. Default no cookies or identifiers. Store id,time,ip,country,region,city,location,browser,os,path. Country translated to Chinese if available; IP location approximate, local explicit label.
- POST /api/admin/login {password}: validate Origin same as Worker URL, bounded body, verify PBKDF2, persistent rate limit in D1, HttpOnly SameSite=Strict Secure cookie in https, expires12h. Use signed HMAC session with revocable D1 session row hashed token, or equivalent. No plain password storage.
- GET /api/admin/session -> {authenticated:true} else401. POST /api/admin/logout -> {ok:true}; clear and revoke token. GET /api/admin/visits?q&from&to&page -> {items,total,page,pageSize:50,pages,summary:{visits,uniqueIps,todayVisits,topRegions:[{region,count}]},retentionDays}. items fields as above. from/to inclusive calendar dates YYYY-MM-DD Asia/Shanghai. Validation invalid400, prepared SQL. GET /api/admin/export same filters -> formula-safe BOM CSV. Admin responses no-store, unauthorized401.
- static Worker path / serves worker/public/index.html via ASSETS. worker/public/admin.js + admin.css + shared.css. No API CORS for admin. Admin user data escaped. Public analytics errors never break interviewing.
- worker/migrations/0001_visitors.sql D1 schema owned by Worker implementer. Prune expired sessions/login limits and visits older90days or beyond100000 with scheduled and reasonable API checks.
- Root owns wrangler.jsonc and deployment secrets outside repository, build script and GitHub workflow, src/visit-config.js and src/visits.js, deployment and E2E tests.

## Verification

Test worker endpoints with real local D1 or SQLite-backed test adapter, PBKDF2 credentials, header spoofing rejection, CORS, auth/access control, escaping, retention and filtering. Browser login, query, export and logout. Re-run interview suite. Verify deployed frontend loads and actual visit request produces a visible backend record. Do not claim tracking live until this succeeds.
