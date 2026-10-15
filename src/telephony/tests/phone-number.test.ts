import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhone } from '../core/phone-number.ts';

test('formats common Indian inputs to E.164 digits', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizePhone('9876543210'), '919876543210');
  assert.equal(normalizePhone('098765 43210'), '919876543210');
  assert.equal(normalizePhone('919876543210'), '919876543210');
  assert.equal(normalizePhone('0091 98765 43210'), '919876543210');
  assert.equal(normalizePhone('(+91) 98765-43210'), '919876543210');
});

test('respects an explicit country code and a custom default', () => {
  assert.equal(normalizePhone('+1 315 805 0050'), '13158050050');
  assert.equal(normalizePhone('3158050050', { defaultCountryCode: '1' }), '13158050050');
});

test('rejects junk and out-of-range numbers', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('12'), null);
  assert.equal(normalizePhone('+1234567890123456789'), null);
});
