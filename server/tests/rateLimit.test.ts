import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RATE_RULES, createLimiter } from '../rateLimit.ts';

const who = (person?: string) => ({ person, address: '1.2.3.4' });

test('allows up to the limit, then says how long to wait', () => {
  let t = 1_000_000;
  const l = createLimiter(RATE_RULES, () => t);
  for (let i = 0; i < 30; i++) assert.equal(l.check('POST', '/api/analyze', who('a')).ok, true);
  const v = l.check('POST', '/api/analyze', who('a'));
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.rule.id, 'analyze');
    assert.ok(v.retryAfterSec >= 1 && v.retryAfterSec <= 60);
  }
  t += 61_000;
  assert.equal(l.check('POST', '/api/analyze', who('a')).ok, true, 'the window has passed');
});

test('each person has their own allowance; the same address does not share it between signed-in people', () => {
  const l = createLimiter(RATE_RULES, () => 5_000);
  for (let i = 0; i < 30; i++) l.check('POST', '/api/analyze', who('a'));
  assert.equal(l.check('POST', '/api/analyze', who('a')).ok, false);
  assert.equal(l.check('POST', '/api/analyze', who('b')).ok, true);
});

test('sign-in is limited per network address, whoever is asking', () => {
  const l = createLimiter(RATE_RULES, () => 5_000);
  for (let i = 0; i < 20; i++) assert.equal(l.check('POST', '/api/auth/login', who()).ok, true);
  assert.equal(l.check('POST', '/api/auth/login', who()).ok, false);
  assert.equal(l.check('POST', '/api/auth/login', { address: '9.9.9.9' }).ok, true);
});

test('the normal polling and saving of a busy agent stays well inside the limits', () => {
  const l = createLimiter(RATE_RULES, () => 1_000);
  for (let i = 0; i < 12; i++) assert.equal(l.check('GET', '/api/data', who('a')).ok, true); // a poll every 6 s is 10 a minute
  for (let i = 0; i < 20; i++) assert.equal(l.check('POST', '/api/data', who('a')).ok, true);
});

test('a route with no specific rule falls under the general one, and non-API paths are never limited', () => {
  const l = createLimiter(RATE_RULES, () => 1_000);
  assert.equal(l.check('GET', '/api/health', who('a')).ok, true);
  assert.equal(l.check('GET', '/index.html', who('a')).ok, true);
  const general = RATE_RULES.find((r) => r.id === 'general')!;
  for (let i = 0; i < general.limit; i++) l.check('GET', '/api/notes', who('z'));
  const v = l.check('GET', '/api/notes', who('z'));
  assert.equal(v.ok, false);
});

test('old counters are swept so memory does not grow', () => {
  let t = 1_000_000;
  const l = createLimiter(RATE_RULES, () => t);
  for (let i = 0; i < 50; i++) l.check('GET', '/api/notes', who(`p${i}`));
  assert.equal(l.size(), 50);
  t += 70 * 60_000; // longer than the longest window
  l.check('GET', '/api/notes', who('later'));
  assert.ok(l.size() <= 2);
});
