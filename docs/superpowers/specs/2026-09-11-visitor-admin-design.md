# Visitor administration

User requests the operator can see which IPs visit and where they are from. Upgrade the existing local Node HTTP server to a deployable application; keep the interview client and standalone HTML working.

## Behavior

Log each successfully served interview HTML GET request (/, /index.html and the bundled HTML). Do not log assets, APIs or admin page as visits. Store UTC time, normalized client IP, approximate country/region/city, pathname without query, derived browser and OS. Geo-IP lookup is local via geoip-lite. Distinguish local/private IP from public unknown location. A page request is a visit, unique IP is not a unique person.

Admin at /admin has password authentication, HTTP-only SameSite Strict session cookies, bounded login attempts, no-store data responses and origin checks on mutations. Admin credentials and SQLite database are outside the explicit static file allowlist. Default random admin password stored locally with restrictive permissions, or ADMIN_PASSWORD environment configuration. Retain logs 90 days and at most 100,000 rows by default. Filter time/IP/location, paginate, export safe UTF-8 CSV and logout. Display IP geolocation as approximate.

Client IP defaults to TCP peer address. Only trust forwarding headers when the socket peer matches configured TRUSTED_PROXIES CIDRs; proxy-addr walks the chain from the server side. Never blindly trust arbitrary X-Forwarded-For, CF-Connecting-IP or X-Real-IP. TLS termination configuration uses explicit PUBLIC_ORIGIN/COOKIE_SECURE settings.

## File ownership and interfaces

- server/analytics.mjs: createAnalytics({dataDir,retentionDays=90,maxVisits=100000,trustedProxies=[],lookup?}) synchronous -> {record(req,pathname), query(filters), exportCsv(filters), close()}. record must not throw for geo lookup failures. getClientIp(req,trustedProxies) exported for tests. Use node:sqlite, geoip-lite, proxy-addr/ipaddr.js.
- query({q='',from='',to='',page=1,pageSize=50}) -> {items,total,page,pageSize,pages,summary:{visits,uniqueIps,todayVisits,topRegions:[{region,count}]},retentionDays}. items {id,time,ip,country,region,city,location,browser,os,path}. from/to YYYY-MM-DD inclusive days in Asia/Shanghai, invalid inputs throw RangeError to map HTTP 400. Stats follow the filters. CSV exports all filtered rows within retention limits, guard spreadsheet formulas.
- server/http.mjs: async createApp({root,dataDir,adminPassword,trustedProxies,secureCookies,publicOrigin,retentionDays,maxVisits,geoLookup}) -> {server,analytics,close}. close stops server and store. server initially not listening.
- API POST /api/admin/login {password} -> {ok:true}; GET /api/admin/session -> {authenticated:true}, else 401; POST /api/admin/logout -> {ok:true}; GET /api/admin/visits with q/from/to/page -> query result; GET /api/admin/export with same filters -> CSV attachment. All admin data requires auth.
- admin.html + src/admin.js + src/admin.css: Chinese dashboard using established warm-paper/forest-green style. Same-origin API; no third-party scripts. Root owns scripts/serve.mjs, deployment/docs, public notice and integrated browser tests.

## Validation

Unit and HTTP integration tests for real-IP trust, header spoofing, geolocation failure, retention, SQL filter validation, auth, login throttling, cookie flags, origin, forbidden private files, export escaping and visit counting. Browser test password login, new logged visit, filters, pagination, download and logout. Keep original interview tests passing. Local browser cannot prove public visitor IP until deployment; local access is labeled honestly.
