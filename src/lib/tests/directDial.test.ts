import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adHocCustomer, adHocId, directDialDigits } from '../directDial.ts';

test('normalises what an agent types', () => {
  assert.equal(directDialDigits('98765 43210', '91'), '919876543210');
  assert.equal(directDialDigits('+44 20 7946 0958', '91'), '442079460958');
  assert.equal(directDialDigits('12', '91'), null);
  assert.equal(directDialDigits('', '91'), null);
});

test('a dialled number becomes a queue-less, flagged customer with a stable id', () => {
  const u = adHocCustomer('919876543210', 'realbroks', 0);
  assert.equal(u.id, adHocId('919876543210'));
  assert.equal(u.phone, '+919876543210');
  assert.equal(u.adHoc, true);
  assert.equal(u.queue, null);
  assert.equal(u.app, 'realbroks');
  assert.deepEqual(u.callHistory, []);
});
