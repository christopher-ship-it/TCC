import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentAccount, CustomerUser } from '../../data/types.ts';
import { runChecks, type ReadinessInput } from '../readiness.ts';

const agent = (id: string, over: Partial<AgentAccount> = {}): AgentAccount => ({
  id, name: id, username: id, role: 'agent', status: 'active', apps: ['realbroks'], queues: ['new'], languages: ['Tamil'], states: ['Tamil Nadu'],
  dailyTarget: 0, clickToDial: true, telecmiUserId: '5001_1', lastActiveLabel: '', todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0,
  avgHandleLabel: '', workingQueueLabel: '', ...over,
});
const customer = (id: string, over: Partial<CustomerUser> = {}): CustomerUser => ({
  id, shopCode: id, name: id, business: id, app: 'realbroks', phone: '+919876543210', city: 'Chennai', state: 'Tamil Nadu', effectiveState: 'Tamil Nadu',
  language: 'Tamil', registeredAtLabel: '', registeredDaysAgo: 3, plan: 'Free', listings: 0, buyers: 0, lastOpenLabel: '', appVersion: '', conversionScore: 0,
  stageTag: 'New', queue: 'new', attempt: 0, callHistory: [], tickets: [], paying: false, active: true, ownerAgentId: null, origin: 'app', ...over,
});

const good: ReadinessInput = {
  backend: 'firestore',
  users: [customer('cust-1'), customer('u-realbroks-1', { origin: 'sample' })],
  agents: [agent('ravi'), agent('demo-dev', { demo: true })],
  telephony: { provider: 'telecmi', testNumber: null, live: true },
  server: { analysis: true, recordings: true },
  appName: (id) => id,
};
const status = (r: ReturnType<typeof runChecks>, id: string) => r.checks.find((c) => c.id === id)?.status;

test('a fully set-up live deployment is ready', () => {
  const r = runChecks(good);
  assert.equal(r.verdict, 'ready');
  assert.equal(r.failed, 0);
  assert.equal(r.warned, 0);
});

test('the local browser build is never ready for real customers', () => {
  const r = runChecks({ ...good, backend: 'local' });
  assert.equal(r.verdict, 'blocked');
  assert.equal(status(r, 'backend'), 'fail');
});

test('demo customers do not count as real customers', () => {
  const r = runChecks({ ...good, users: [customer('u-realbroks-1', { origin: 'sample' })] });
  assert.equal(status(r, 'real-customers'), 'fail');
  assert.equal(r.verdict, 'blocked');
});

test('demo accounts do not count as agents who can call real customers', () => {
  const r = runChecks({ ...good, agents: [agent('demo-dev', { demo: true })] });
  assert.equal(status(r, 'agents'), 'fail');
});

test('test mode is safe but is a warning, not ready to go live', () => {
  const r = runChecks({ ...good, telephony: { provider: 'telecmi', testNumber: '8270942966', live: false } });
  assert.equal(status(r, 'dialling'), 'warn');
  assert.equal(r.verdict, 'caution');
});

test('calling that is locked, or only a demo line, blocks', () => {
  assert.equal(status(runChecks({ ...good, telephony: { provider: 'telecmi', testNumber: null, live: false } }), 'dialling'), 'fail');
  assert.equal(status(runChecks({ ...good, telephony: { provider: 'mock', testNumber: null, live: false } }), 'dialling'), 'fail');
});

test('customers nobody can reach are called out', () => {
  const r = runChecks({ ...good, users: [customer('cust-1', { effectiveState: 'Kerala', language: 'Malayalam' })] });
  assert.equal(status(r, 'coverage'), 'warn');
});

test('a real customer owned by a demo account blocks', () => {
  const r = runChecks({ ...good, users: [customer('cust-1', { ownerAgentId: 'demo-dev' })] });
  assert.equal(status(r, 'demo-leak'), 'fail');
});

test('missing server keys warn without blocking', () => {
  const r = runChecks({ ...good, server: { analysis: false, recordings: false } });
  assert.equal(status(r, 'recordings'), 'warn');
  assert.equal(status(r, 'analysis'), 'warn');
  assert.equal(r.verdict, 'caution');
});

test('numbers that cannot be dialled are flagged', () => {
  assert.equal(status(runChecks({ ...good, users: [customer('cust-1', { phone: '12' })] }), 'phones'), 'warn');
});
