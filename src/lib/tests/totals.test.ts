import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countEverything } from '../totals.ts';
import { adHocCustomer } from '../directDial.ts';
import type { AgentAccount, CallLogEntry, CustomerUser, EscalationRecord } from '../../data/types.ts';

const NOW = Date.parse('2026-10-30T12:00:00+05:30');
const DAY = 86_400_000;

const call = (over: Partial<CallLogEntry>): CallLogEntry => ({ id: Math.random().toString(36), atLabel: '', atTs: NOW - DAY * 3, agentName: 'Priya', status: 'No Answer', comment: '', ...over });

const customer = (id: string, app: CustomerUser['app'], over: Partial<CustomerUser> = {}): CustomerUser => ({
  ...adHocCustomer(`+91987654${id.padStart(4, '0')}`, app, NOW),
  id,
  adHoc: undefined,
  ...over,
});

const person = (id: string, role: AgentAccount['role'], apps: AgentAccount['apps'], over: Partial<AgentAccount> = {}) =>
  ({ id, name: id, role, apps, queues: [], languages: [], states: [], status: 'active', ...over }) as unknown as AgentAccount;

const esc = (app: EscalationRecord['app'], status: EscalationRecord['status'], urgency?: 'urgent'): EscalationRecord =>
  ({ id: Math.random().toString(36), type: 'escalation', userId: 'x', userName: 'x', userCity: '', app, raisedAtLabel: '', raisedTs: NOW, raisedByAgentId: 'a', reason: '', note: '', status, urgency }) as EscalationRecord;

test('counts customers, calls, follow-ups, escalations, notes and people per product', () => {
  const users = [
    customer('1', 'irondrobe', { sync: { sourceId: 's1', syncedAt: NOW } as CustomerUser['sync'], queue: 'inactive', callHistory: [call({ status: 'Answered — DG', atTs: NOW - 1000, telephony: { provider: 't', callId: null, durationSec: 90, ringSec: 3, disposition: 'ANSWERED', direction: 'inbound' } })], lead: 'positive', callback: { dueTs: NOW - 2 * DAY, auto: false } }),
    customer('2', 'irondrobe', { sync: { sourceId: 's2', syncedAt: NOW } as CustomerUser['sync'], queue: 'errors' }),
    customer('3', 'realbroks', { manual: true, queue: null, callHistory: [call({}), call({ atTs: NOW - 20 * DAY })], callback: { dueTs: NOW, auto: true } }),
    customer('4', 'realbroks', { deleted: { byId: 'a', byName: 'a', reason: 'test', ts: NOW, atLabel: '' }, callHistory: [call({})] }),
    customer('5', 'influnet', { callHistory: [call({})] }),
  ];
  const agents = [
    person('a1', 'agent', ['irondrobe', 'realbroks']),
    person('a2', 'agent', ['irondrobe'], { status: 'suspended' }),
    person('s1', 'supervisor', ['realbroks']),
    person('ad', 'admin', []),
    person('super', 'admin', [], { superAdmin: true }),
  ];
  const escalations = [esc('irondrobe', 'pending', 'urgent'), esc('irondrobe', 'approved'), esc('realbroks', 'pending'), esc('influnet', 'pending')];
  const notes = [{ app: null, audience: 'agents', count: 2 }, { app: 'irondrobe', audience: 'me', count: 3 }, { app: 'influnet', audience: 'me', count: 9 }];

  const { overall, byApp } = countEverything({ users, agents, escalations, notes }, ['irondrobe', 'realbroks'], NOW);

  assert.equal(overall.customers, 3, 'deleted and out-of-scope customers are left out');
  assert.equal(overall.fromProduct, 2);
  assert.equal(overall.addedInTcc, 1);
  assert.equal(overall.neverCalled, 1);
  assert.equal(overall.calls, 3);
  assert.equal(overall.connected, 1);
  assert.equal(overall.incoming, 1);
  assert.equal(overall.callsToday, 1);
  assert.equal(overall.calls7d, 2);
  assert.equal(overall.talkSec, 90);
  assert.equal(overall.byStatus['No Answer'], 2);
  assert.deepEqual([overall.followUps, overall.followUpsOverdue, overall.followUpsToday], [2, 1, 1]);
  assert.deepEqual(overall.followUpsByKind, { agent: 1, auto: 1, weekly: 0 });
  assert.equal(overall.positive, 1);
  assert.deepEqual([overall.escalations, overall.escalationsWaiting, overall.escalationsUrgent, overall.escalationsApproved], [3, 2, 1, 1]);
  assert.deepEqual([overall.notes, overall.notesForAgents], [5, 2], 'notes for every product count overall; other products are left out');
  assert.equal(byApp.irondrobe.notes, 3);
  assert.deepEqual([overall.agents, overall.supervisors, overall.admins], [1, 1, 1], 'suspended people and the super admin are not counted');
  assert.deepEqual([byApp.irondrobe.agents, byApp.realbroks.agents, byApp.realbroks.supervisors, byApp.irondrobe.admins], [1, 1, 1, 1]);
  assert.deepEqual([byApp.irondrobe.byQueue.inactive, byApp.irondrobe.byQueue.errors, byApp.realbroks.byQueue.none], [1, 1, 1]);
});

test('without a server there are no notes to count', () => {
  const { overall } = countEverything({ users: [], agents: [], escalations: [], notes: null }, ['irondrobe'], NOW);
  assert.equal(overall.notes, null);
});
