import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inProduct, mayEnter } from '../product.ts';
import type { AgentAccount } from '../../data/types.ts';

const person = (over: Partial<AgentAccount>): AgentAccount => ({
  id: 'a', name: 'A', username: 'a', role: 'agent', apps: ['realbroks', 'irondrobe'], queues: [], languages: [], states: [], dailyTarget: 0, clickToDial: true,
  lastActiveLabel: '', todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '', workingQueueLabel: '', ...over,
});

test('a person goes into a product only if their account has it; admins go into any', () => {
  assert.equal(mayEnter(person({}), 'irondrobe'), true);
  assert.equal(mayEnter(person({ apps: ['realbroks'] }), 'irondrobe'), false);
  assert.equal(mayEnter(person({ role: 'supervisor', apps: ['realbroks'] }), 'irondrobe'), false);
  assert.equal(mayEnter(person({ role: 'admin', apps: [] }), 'irondrobe'), true);
  assert.equal(mayEnter(person({ superAdmin: true, role: 'admin', apps: [] }), 'vehigo'), true);
});

test('inside a product, agents and supervisors see only it; the stored account is not changed', () => {
  const agent = person({});
  const inside = inProduct(agent, 'irondrobe');
  assert.deepEqual(inside.apps, ['irondrobe']);
  assert.deepEqual(agent.apps, ['realbroks', 'irondrobe']);
  assert.deepEqual(inProduct(person({ role: 'supervisor' }), 'realbroks').apps, ['realbroks']);
  const admin = person({ role: 'admin' });
  assert.equal(inProduct(admin, 'irondrobe'), admin, 'admins can still look across products');
});
