import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentAccount, AuditEntry, CustomerUser, EscalationRecord } from '../../data/types.ts';
import { adHocCustomer, adHocId } from '../directDial.ts';
import { isReachable, nextTask, reachableCount, tasksForQueue } from '../queue.ts';
import { countByOrigin, originForNewCustomer, originOf, realCustomersOwnedByDemo, sameWorld, scopeFor } from '../world.ts';

const agent = (id: string, over: Partial<AgentAccount> = {}): AgentAccount => ({
  id, name: id, username: id, role: 'agent', apps: ['realbroks'], queues: ['new'], languages: ['Tamil'], states: ['Tamil Nadu'],
  dailyTarget: 0, clickToDial: true, lastActiveLabel: '', todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0,
  avgHandleLabel: '', workingQueueLabel: '', ...over,
});

const customer = (id: string, over: Partial<CustomerUser> = {}): CustomerUser => ({
  id, shopCode: id, name: id, business: id, app: 'realbroks', phone: '+919876543210', city: 'Chennai', state: 'Tamil Nadu', effectiveState: 'Tamil Nadu',
  language: 'Tamil', registeredAtLabel: '', registeredDaysAgo: 3, plan: 'Free', listings: 0, buyers: 0, lastOpenLabel: '', appVersion: '', conversionScore: 0,
  stageTag: 'New', queue: 'new', attempt: 0, callHistory: [], tickets: [], paying: false, active: true, ownerAgentId: null, ...over,
});

const real = customer('cust-919876543210', { origin: 'app' });
const demoCustomer = customer('u-realbroks-1', { origin: 'sample' });
const dialled = customer('adhoc-919800000000', { adHoc: true, origin: 'tcc', queue: null });

test('records saved before `origin` existed are classified by how they were made', () => {
  assert.equal(originOf({ id: 'cust-9198', adHoc: undefined, origin: undefined }), 'app');
  assert.equal(originOf({ id: 'adhoc-9198', adHoc: true, origin: undefined }), 'tcc');
  assert.equal(originOf({ id: 'u-realbroks-4', adHoc: undefined, origin: undefined }), 'sample');
  assert.equal(originOf({ id: 'anything', origin: 'tcc' }), 'tcc');
});

test('a demo account is never served a real customer, even one it covers in every other way', () => {
  const demo = agent('demo', { demo: true });
  assert.equal(isReachable(demo, real), false);
  assert.equal(isReachable(demo, dialled), false);
  assert.equal(isReachable(demo, demoCustomer), true);
  assert.deepEqual(tasksForQueue(demo, [real, demoCustomer], 'realbroks', 'new').map((u) => u.id), ['u-realbroks-1']);
  assert.equal(nextTask(demo, [real], null), null);
});

test('a real account is never served a demo customer', () => {
  const live = agent('live');
  assert.equal(isReachable(live, demoCustomer), false);
  assert.equal(isReachable(live, real), true);
  assert.deepEqual(tasksForQueue(live, [real, demoCustomer], 'realbroks', 'new').map((u) => u.id), ['cust-919876543210']);
});

test('reach counts in the editor ignore the other world', () => {
  const users = [real, demoCustomer, customer('cust-2', { origin: 'app' })];
  assert.equal(reachableCount({ apps: ['realbroks'], languages: ['Tamil'], states: ['Tamil Nadu'] }, users), 2);
  assert.equal(reachableCount({ apps: ['realbroks'], languages: ['Tamil'], states: ['Tamil Nadu'], demo: true }, users), 1);
});

test('sameWorld pairs demo with demo and real with real', () => {
  assert.equal(sameWorld({ demo: true }, demoCustomer), true);
  assert.equal(sameWorld({ demo: true }, real), false);
  assert.equal(sameWorld({}, real), true);
  assert.equal(sameWorld({}, demoCustomer), false);
});

test('numbers dialled by a demo account stay in the demo world, apart from the same real number', () => {
  assert.equal(originForNewCustomer({ demo: true }), 'sample');
  assert.equal(originForNewCustomer({}), 'tcc');
  const mine = adHocCustomer('919800000000', 'realbroks', 0, 'sample');
  const theirs = adHocCustomer('919800000000', 'realbroks', 0);
  assert.notEqual(mine.id, theirs.id);
  assert.equal(mine.id, adHocId('919800000000', true));
  assert.equal(mine.origin, 'sample');
  assert.equal(theirs.origin, 'tcc');
});

const audit = (id: string, demo?: boolean): AuditEntry => ({ id, ts: 0, actorId: 'x', actorName: 'x', action: 'signed_in', detail: '', ...(demo ? { demo } : {}) });
const esc = (userId: string): EscalationRecord => ({ id: `e-${userId}`, type: 'escalation', userId, userName: userId, userCity: '', app: 'realbroks', raisedAtLabel: '', raisedTs: 0, raisedByAgentId: 'x', reason: '', note: '', status: 'pending' });

const store = {
  agents: [agent('demo', { demo: true }), agent('live'), agent('admin', { role: 'admin' })],
  users: [real, demoCustomer, dialled],
  audit: [audit('a-real'), audit('a-demo', true)],
  escalations: [esc(real.id), esc(demoCustomer.id)],
  clearedEscalations: [{ demo: true }, {}],
};

test('a demo account sees only the demo world', () => {
  const s = scopeFor({ demo: true }, store);
  assert.deepEqual(s.agents.map((a) => a.id), ['demo']);
  assert.deepEqual(s.users.map((u) => u.id), ['u-realbroks-1']);
  assert.deepEqual(s.audit.map((e) => e.id), ['a-demo']);
  assert.deepEqual(s.escalations.map((e) => e.userId), ['u-realbroks-1']);
  assert.equal(s.clearedEscalations.length, 1);
});

test('everyone else sees only the real world, without the demo accounts', () => {
  const s = scopeFor({}, store);
  assert.deepEqual(s.agents.map((a) => a.id), ['live', 'admin']);
  assert.deepEqual(s.users.map((u) => u.id), ['cust-919876543210', 'adhoc-919800000000']);
  assert.deepEqual(s.audit.map((e) => e.id), ['a-real']);
  assert.deepEqual(s.escalations.map((e) => e.userId), ['cust-919876543210']);
});

test('nothing is filtered before anyone has signed in', () => {
  assert.equal(scopeFor(null, store), store);
});

test('finds real customers still owned by a demo account', () => {
  const owned = { ...real, ownerAgentId: 'demo' };
  assert.deepEqual(realCustomersOwnedByDemo([owned, { ...demoCustomer, ownerAgentId: 'demo' }, real], store.agents).map((u) => u.id), [owned.id]);
});

test('counts customers per app and origin', () => {
  assert.deepEqual(countByOrigin([real, demoCustomer, dialled, customer('cust-3', { origin: 'app', app: 'irondrobe' })]), {
    realbroks: { app: 1, tcc: 1, sample: 1 },
    irondrobe: { app: 1, tcc: 0, sample: 0 },
  });
});
