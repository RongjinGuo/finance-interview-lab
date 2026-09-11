const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const code = readFileSync(require.resolve('../src/visits.js'), 'utf8');
function run(protocol, endpoint, pathname = '/finance-interview-lab/', failure = false) {
  const requests = [];
  vm.runInNewContext(code, {
    window: { location: { protocol, pathname, search: '?secret=do-not-send' }, FinanceVisitConfig: { endpoint } },
    URL,
    fetch(url, options) { requests.push({ url, options }); return failure ? Promise.reject(new Error('offline')) : Promise.resolve({ status: 204 }); }
  });
  return requests;
}
test('offline and unconfigured pages never report visits', () => {
  assert.deepEqual(run('file:', 'https://visits.example/api/visit'), []);
  assert.deepEqual(run('https:', ''), []);
});
test('deployed page reports only path without query, answers, cookies or referrer', () => {
  const [request] = run('https:', 'https://visits.example/api/visit');
  assert.equal(request.url, 'https://visits.example/api/visit');
  assert.deepEqual(JSON.parse(request.options.body), { path: '/finance-interview-lab/' });
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(request.options.keepalive, true);
});
test('insecure public endpoints are ignored and failed visits do not break the page', async () => {
  assert.deepEqual(run('https:', 'http://visits.example/api/visit'), []);
  assert.doesNotThrow(() => run('https:', 'bad url'));
  assert.equal(run('https:', 'https://visits.example/api/visit', '/', true).length, 1);
  await new Promise(resolve => setImmediate(resolve));
});
