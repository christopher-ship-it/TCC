import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adHocCustomer, adHocId } from '../directDial.ts';
import { matchCaller, resolveCaller } from '../inbound.ts';
import type { CustomerUser } from '../../data/types.ts';

const customer = (id: string, phone: string, app: CustomerUser['app'] = 'vanmoh'): CustomerUser => ({ ...adHocCustomer('910000000000', app, 0), id, phone, name: id, adHoc: false });

test('a caller is matched on the last 10 digits, within the agent’s apps, real customers first', () => {
  const users = [customer('dd', '+91 98765 43210'), customer('real', '098765 43210'), customer('other-app', '9876543210', 'realbroks')];
  users[0].adHoc = true;
  assert.equal(matchCaller(users, '919876543210', ['vanmoh'])?.id, 'real');
  assert.equal(matchCaller(users, '919876543210', ['realbroks'])?.id, 'other-app');
  assert.equal(matchCaller(users, '919999999999', ['vanmoh']), null);
  assert.equal(matchCaller(users, 'unknown', ['vanmoh']), null);
});

test('an unknown caller gets a new record under the agent’s first app; a repeat caller reuses it', () => {
  const first = resolveCaller([], '919812345678', ['vanmoh', 'realbroks'], 0);
  assert.equal(first?.isNew, true);
  assert.equal(first?.customer.id, adHocId('919812345678'));
  assert.equal(first?.customer.app, 'vanmoh');
  assert.equal(first?.customer.business, 'Incoming call');
  assert.equal(first?.customer.adHoc, true);

  const again = resolveCaller([first!.customer], '+91 98123 45678', ['vanmoh'], 0);
  assert.deepEqual([again?.isNew, again?.customer.id], [false, first!.customer.id]);
});

test('nothing to file it under: no apps, or a withheld number', () => {
  assert.equal(resolveCaller([], '919812345678', []), null);
  assert.equal(resolveCaller([], 'unknown', ['vanmoh']), null);
});
