import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outOfReach } from '../queue.ts';
import { adHocCustomer } from '../directDial.ts';
import type { AgentAccount, CustomerUser } from '../../data/types.ts';

const NOW = Date.parse('2026-10-30T12:00:00+05:30');
const synced = (id: string, over: Partial<CustomerUser>): CustomerUser => ({ ...adHocCustomer(`+91987654${id.padStart(4, '0')}`, 'irondrobe', NOW), id, adHoc: undefined, state: 'Tamil Nadu', effectiveState: 'Tamil Nadu', language: 'Tamil', ...over });
const agent = { id: 'a', name: 'Priya', role: 'agent', apps: ['irondrobe'], queues: ['new', 'followup'], states: ['Tamil Nadu'], languages: ['Tamil'], status: 'active' } as unknown as AgentAccount;

test('says why a product’s customers are out of an agent’s reach', () => {
  const users = [
    synced('1', { queue: 'inactive' }),
    synced('2', { queue: 'inactive' }),
    synced('3', { queue: 'errors' }),
    synced('4', { queue: 'new', state: 'Kerala', effectiveState: 'Kerala', language: 'Malayalam' }),
    synced('5', { queue: 'new', language: 'Telugu' }),
    synced('6', { queue: 'new' }),
    synced('7', { queue: null }),
  ];
  const r = outOfReach(agent, users, 'irondrobe', NOW);
  assert.deepEqual(r, { lists: { inactive: 2, errors: 1 }, states: 1, languages: 1, total: 5 });
  assert.equal(outOfReach({ ...agent, apps: ['realbroks'] }, users, 'irondrobe', NOW).total, 0, 'a product not on the account is a different message');
});
