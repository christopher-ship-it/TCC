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

// --- the team's call order: new installs, then no answer, then positive follow-ups ---
import { nextTask, queueOf, tasksForQueue } from '../queue.ts';
import { NO_ANSWER_ENDED_TAG, startOfDay } from '../followUps.ts';

const caller = { ...agent, queues: ['new', 'noanswer', 'followup', 'unreached'] } as unknown as AgentAccount;
const ids = (list: CustomerUser[]) => list.map((u) => u.id);
const today = startOfDay(NOW);

test('people who signed up yesterday are called first, then today’s, then older ones', () => {
  const users = [synced('1', { queue: 'new', registeredDaysAgo: 5 }), synced('2', { queue: 'new', registeredDaysAgo: 0 }), synced('3', { queue: 'new', registeredDaysAgo: 1 }), synced('4', { queue: 'new', registeredDaysAgo: 2 })];
  assert.deepEqual(ids(tasksForQueue(caller, users, 'irondrobe', 'new', NOW)), ['3', '2', '4', '1']);
});

test('a call-back that is due lands in No answer (automatic) or Follow-up (agent’s date); a future one waits', () => {
  const auto = synced('1', { queue: 'new', callback: { dueTs: today, auto: true } });
  const chosen = synced('2', { queue: 'followup', callback: { dueTs: today, auto: false } });
  const later = synced('3', { queue: 'new', callback: { dueTs: today + 86_400_000, auto: true } });
  assert.equal(queueOf(auto, NOW), 'noanswer');
  assert.equal(queueOf(chosen, NOW), 'followup');
  assert.equal(queueOf(later, NOW), null);
});

test('after 14 days with no answer they leave the queues and wait in Not reached, until someone gets through', () => {
  const ended = synced('1', { queue: null, stageTag: NO_ANSWER_ENDED_TAG });
  assert.equal(queueOf(ended, NOW), 'unreached');
  assert.deepEqual(ids(tasksForQueue(caller, [ended], 'irondrobe', 'unreached', NOW)), ['1']);
  const reached = { ...ended, callHistory: [{ id: 'c', atTs: NOW, atLabel: '', agentName: 'x', status: 'Answered — Followup', comment: '', telephony: { durationSec: 40 } }] } as unknown as CustomerUser;
  assert.equal(queueOf(reached, NOW), null);
  assert.equal(nextTask(caller, [ended], 'irondrobe'), null, '"Call next" does not serve the Not reached list');
});

test('High priority is listed first in No answer and Follow-up', () => {
  const mk = (id: string, priority: 'High' | 'Medium' | 'Low' | undefined, auto: boolean) => synced(id, { queue: auto ? 'new' : 'followup', priority, callback: { dueTs: today, auto } });
  const noanswer = [mk('1', 'Low', true), mk('2', undefined, true), mk('3', 'High', true), mk('4', 'Medium', true)];
  assert.deepEqual(ids(tasksForQueue(caller, noanswer, 'irondrobe', 'noanswer', NOW)), ['3', '4', '2', '1']);
  const follow = [mk('1', 'Low', false), mk('2', 'High', false), mk('3', 'Medium', false)];
  assert.deepEqual(ids(tasksForQueue(caller, follow, 'irondrobe', 'followup', NOW)), ['2', '3', '1']);
});

test('"Call next" goes new installs, then No answer, then Follow-up', () => {
  const users = [synced('1', { queue: 'followup', callback: { dueTs: today, auto: false } }), synced('2', { queue: 'new', callback: { dueTs: today, auto: true } })];
  assert.equal(nextTask(caller, users, 'irondrobe')?.queue, 'noanswer');
  assert.equal(nextTask(caller, [users[0]], 'irondrobe')?.queue, 'followup');
  assert.equal(nextTask(caller, [synced('3', { queue: 'new' }), ...users], 'irondrobe')?.queue, 'new');
});

// --- handed-out lists: an agent sees only the customers the server gave them ---
import { assignmentMode, waitingForYou } from '../queue.ts';

function withAssignment(fn: () => void) {
  assignmentMode.on = true;
  try {
    fn();
  } finally {
    assignmentMode.on = false;
  }
}

test('with customers handed out, an agent sees only their own on New installs, No answer and Follow-up', () => {
  withAssignment(() => {
    const users = [
      synced('1', { queue: 'new', ownerAgentId: 'a' }),
      synced('2', { queue: 'new', ownerAgentId: 'someone-else' }),
      synced('3', { queue: 'new', ownerAgentId: null }),
      synced('4', { queue: 'new', callback: { dueTs: today, auto: true }, ownerAgentId: 'a' }),
      synced('5', { queue: 'followup', callback: { dueTs: today, auto: false }, ownerAgentId: 'someone-else' }),
    ];
    assert.deepEqual(ids(tasksForQueue(caller, users, 'irondrobe', 'new', NOW)), ['1']);
    assert.deepEqual(ids(tasksForQueue(caller, users, 'irondrobe', 'noanswer', NOW)), ['4']);
    assert.deepEqual(ids(tasksForQueue(caller, users, 'irondrobe', 'followup', NOW)), []);
  });
});

test('the other lists stay a shared pool, and so does everything before the server hands customers out', () => {
  const users = [synced('1', { queue: 'new', ownerAgentId: 'someone-else' }), synced('2', { queue: 'inactive', ownerAgentId: 'someone-else' })];
  const picker = { ...caller, queues: ['new', 'inactive'] } as unknown as AgentAccount;
  assert.deepEqual(ids(tasksForQueue(picker, users, 'irondrobe', 'new', NOW)), ['1'], 'sample data: no server, so shared');
  withAssignment(() => {
    assert.deepEqual(ids(tasksForQueue(picker, users, 'irondrobe', 'inactive', NOW)), ['2']);
    assert.deepEqual(ids(tasksForQueue(picker, users, 'irondrobe', 'new', NOW)), []);
  });
});

test('a supervisor still sees the whole pool, not just their own', () => {
  withAssignment(() => {
    const sup = { ...caller, role: 'supervisor' } as unknown as AgentAccount;
    assert.deepEqual(ids(tasksForQueue(sup, [synced('1', { queue: 'new', ownerAgentId: 'someone-else' })], 'irondrobe', 'new', NOW)), ['1']);
  });
});

test('says how many customers are lined up for an agent but not given yet', () => {
  withAssignment(() => {
    const users = [synced('1', { queue: 'new' }), synced('2', { queue: 'new' }), synced('3', { queue: 'new', language: 'Telugu' }), synced('4', { queue: 'new', ownerAgentId: 'a' }), synced('5', { queue: 'tickets' })];
    assert.equal(waitingForYou(caller, users, 'irondrobe', NOW), 2, 'only unowned ones in her language on her lists');
    // Customers held by others are not "out of reach": the agent is told nothing is hidden from them.
    assert.equal(outOfReach(caller, [synced('9', { queue: 'new', ownerAgentId: 'someone-else' })], 'irondrobe', NOW).total, 0);
  });
});
