import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateWindow, inWindow, textMatch, DAY } from '../filters.ts';

test('search matches any field, ignoring case, and phone numbers however they are written', () => {
  assert.equal(textMatch('', 'anything'), true);
  assert.equal(textMatch('meena', 'Meena Reddy', 'Shop'), true);
  assert.equal(textMatch('SHOP', 'Meena', 'Reddy Shop'), true);
  assert.equal(textMatch('98765', 'Meena', '+91 98765 43210'), true);
  assert.equal(textMatch('98 76', 'Meena', '+919876543210'), true, 'four digits, spaces ignored');
  assert.equal(textMatch('12', 'Meena', '+919876543210'), false, 'two digits is too short to count as a number search');
});

test('date ranges are whole local days', () => {
  const now = new Date(2026, 9, 31, 15, 0).getTime();
  const midnight = new Date(2026, 9, 31).getTime();
  assert.deepEqual(dateWindow('today', now), { from: midnight, to: midnight + DAY });
  assert.deepEqual(dateWindow('yesterday', now), { from: midnight - DAY, to: midnight });
  assert.equal(inWindow(midnight - 1, dateWindow('today', now)), false);
  assert.equal(inWindow(midnight - 5 * DAY, dateWindow('7d', now)), true);
  assert.equal(inWindow(midnight - 7 * DAY, dateWindow('7d', now)), false);
  assert.equal(inWindow(0, dateWindow('any', now)), true);
});
