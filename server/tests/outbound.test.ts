import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeFailure } from '../appSync.ts';
import { endpointOf, outboundStats, recentOutbound, recordOutbound, resetOutbound } from '../outbound.ts';

test('a 404 that is a web page says the API route is gone, not just "404"', () => {
  const m = describeFailure('irondrobe', 'customers', 404, 'text/html; charset=utf-8', null);
  assert.match(m, /web page, not the API/);
  assert.match(m, /moved or removed/);
  assert.doesNotMatch(m, /Bearer|key_/);
});

test('other failures name the product and the endpoint', () => {
  assert.match(describeFailure('irondrobe', 'meta', 401, 'application/json', { error: { code: 'invalid_api_key' } }), /refused the key/);
  assert.match(describeFailure('irondrobe', 'customers', 429, null, null), /rate limiting/);
  assert.match(describeFailure('irondrobe', 'customers', 502, null, null), /had an error \(502\)/);
  assert.match(describeFailure('irondrobe', 'customers', 404, 'application/json', { error: { code: 'not_found' } }), /404 \(not_found\)/);
});

test('endpoints are grouped without ids or query values', () => {
  assert.equal(endpointOf('customers?limit=500&cursor=abc&updated_since=2026-10-30'), 'customers');
  assert.equal(endpointOf('customers/u_8f2c91'), 'customers/:id');
  assert.equal(endpointOf('customers/lookup'), 'customers/lookup');
  assert.equal(endpointOf('/meta'), 'meta');
});

test('counts calls per endpoint and keeps the newest first', () => {
  resetOutbound();
  recordOutbound({ ts: 1, service: 'irondrobe', method: 'GET', endpoint: 'customers', status: 200, ms: 100 });
  recordOutbound({ ts: 2, service: 'irondrobe', method: 'GET', endpoint: 'customers', status: 404, ms: 300, error: 'gone' });
  recordOutbound({ ts: 3, service: 'realbroks', method: 'GET', endpoint: 'meta', status: 200, ms: 50 });
  const [s] = outboundStats('irondrobe');
  assert.equal(s.count, 2);
  assert.equal(s.errors, 1);
  assert.equal(s.avgMs, 200);
  assert.equal(s.maxMs, 300);
  assert.equal(s.lastOkTs, 1);
  assert.equal(s.lastError, 'gone');
  assert.deepEqual(recentOutbound('irondrobe').map((c) => c.ts), [2, 1]);
  assert.equal(outboundStats().length, 2);
});
