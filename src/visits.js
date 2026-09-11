(function () {
  'use strict';
  if (!/^https?:$/.test(window.location.protocol)) return;
  const endpoint = window.FinanceVisitConfig?.endpoint;
  if (!endpoint) return;
  try {
    const target = new URL(endpoint);
    if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) return;
    fetch(target.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true
    }).catch(() => {});
  } catch { /* A tracking outage must not interrupt interview practice. */ }
})();
