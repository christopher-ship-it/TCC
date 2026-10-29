import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySource, keepSourceFields, pickPerNumber, sameCustomer, sourceQueue, type SourceCustomer, type SourceMeta } from '../appSync.ts';
import { adHocCustomer } from '../directDial.ts';
import type { CustomerUser } from '../../data/types.ts';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const META: SourceMeta = { app: 'irondrobe', onboarding_stages: [{ stage: 'registered', label: 'Signed up' }, { stage: 'profile_completed', label: 'Filled shop details' }, { stage: 'first_order_created', label: 'Created first order' }] };

const src = (over: Partial<SourceCustomer> = {}): SourceCustomer => ({
  id: 'u1',
  app: 'irondrobe',
  name: 'Suresh Kumar',
  phone: '+919876543210',
  business_name: 'Suresh Ironing',
  city: 'Chennai',
  state: 'Tamil Nadu',
  preferred_language: null,
  registered_at: iso(40),
  last_active_at: iso(2),
  app_version: '2.30',
  platform: 'android',
  onboarding: { stage: 'first_order_created', completed: true, last_error: null },
  usage: { primary_count: 16, secondary_count: 8, last_action_at: iso(2) },
  plan: { name: 'Free', is_paid: false },
  payment_due: null,
  open_tickets: [],
  account_status: 'active',
  updated_at: iso(1),
  ...over,
});

const ok = (r: ReturnType<typeof applySource>): CustomerUser => {
  assert.ok('customer' in r, `expected a customer, got ${JSON.stringify(r)}`);
  return r.customer;
};

test('a new product customer becomes a TCC customer keyed by their mobile', () => {
  const c = ok(applySource(undefined, src(), 'irondrobe', META, NOW));
  assert.equal(c.id, 'cust-919876543210');
  assert.equal(c.phone, '+919876543210');
  assert.deepEqual([c.name, c.business, c.city, c.state, c.effectiveState, c.language], ['Suresh Kumar', 'Suresh Ironing', 'Chennai', 'Tamil Nadu', 'Tamil Nadu', 'Tamil']);
  assert.deepEqual([c.listings, c.buyers, c.appVersion, c.registeredDaysAgo], [16, 8, '2.30', 40]);
  assert.equal(c.sync?.sourceId, 'u1');
  assert.equal(c.sync?.stageLabel, 'Created first order');
  assert.equal(c.queue, null); // set up and active: nothing to call about
  assert.equal(c.adHoc, false);
});

test('call lists come from the product’s data, most urgent first', () => {
  assert.equal(sourceQueue(src({ registered_at: iso(2), onboarding: { stage: 'registered', completed: false } }), NOW), 'new');
  assert.equal(sourceQueue(src({ last_active_at: iso(45) }), NOW), 'inactive');
  assert.equal(sourceQueue(src({ onboarding: { stage: 'profile_completed', completed: false } }), NOW), 'errors');
  assert.equal(sourceQueue(src({ onboarding: { stage: 'registered', completed: false, last_error: { code: 'x', message: 'UPI declined', at: iso(1) } } }), NOW), 'errors');
  assert.equal(sourceQueue(src({ open_tickets: [{ id: 't', subject: 'Cannot print', status: 'open', created_at: iso(1), sla_breached: false }], last_active_at: iso(45) }), NOW), 'tickets');
  assert.equal(sourceQueue(src({ payment_due: { amount: { amount: 499, currency: 'INR' }, due_date: '2026-10-25', status: 'overdue' } }), NOW), 'payments');
  assert.equal(sourceQueue(src({ payment_due: { amount: { amount: 499, currency: 'INR' }, due_date: '2026-12-25', status: 'upcoming' } }), NOW), null);
  assert.equal(sourceQueue(src({ account_status: 'deleted' }), NOW), null);
});

test('no name falls back to the shop; no state lands with the home state’s agents', () => {
  const c = ok(applySource(undefined, src({ name: null, state: null, city: null }), 'irondrobe', META, NOW));
  assert.equal(c.name, 'Suresh Ironing');
  assert.deepEqual([c.state, c.effectiveState, c.city], [null, 'Tamil Nadu', '—']);
});

test('a state agents don’t cover goes to the nearest one they do; a regional app language wins over the state’s', () => {
  const p = ok(applySource(undefined, src({ state: 'Puducherry' }), 'irondrobe', META, NOW));
  assert.deepEqual([p.state, p.effectiveState, p.language], [null, 'Tamil Nadu', 'Tamil']);
  const k = ok(applySource(undefined, src({ state: 'Karnataka', preferred_language: 'ta' }), 'irondrobe', META, NOW));
  assert.equal(k.language, 'Tamil');
  const e = ok(applySource(undefined, src({ state: 'Kerala', preferred_language: 'en' }), 'irondrobe', META, NOW));
  assert.equal(e.language, 'Malayalam');
});

test('left out: no phone, a closed account TCC never had, another product’s customer', () => {
  assert.deepEqual(applySource(undefined, src({ phone: null }), 'irondrobe', META, NOW), { skip: 'no-phone' });
  assert.deepEqual(applySource(undefined, src({ account_status: 'deleted' }), 'irondrobe', META, NOW), { skip: 'closed' });
  const rb = { ...ok(applySource(undefined, src(), 'irondrobe', META, NOW)), app: 'realbroks' as const, sync: undefined };
  assert.deepEqual(applySource(rb, src(), 'irondrobe', META, NOW), { skip: 'other-product' });
});

test('an existing customer keeps everything TCC did: calls, owner, lead, follow-up, type, language, queue', () => {
  const first = ok(applySource(undefined, src({ registered_at: iso(2), onboarding: { stage: 'registered', completed: false } }), 'irondrobe', META, NOW));
  assert.equal(first.queue, 'new');
  const worked: CustomerUser = {
    ...first,
    callHistory: [{ id: 'c1', atLabel: '', atTs: NOW, agentName: 'Priya', status: 'Answered — Followup', comment: 'call back' }],
    ownerAgentId: 'agent-1', lead: 'positive', customerType: 'Shop owner', language: 'English', queue: 'followup', stageTag: 'Interested',
    callback: { dueTs: NOW + DAY, auto: false },
  };
  const next = ok(applySource(worked, src({ name: 'Suresh K', registered_at: iso(2), last_active_at: iso(0), onboarding: { stage: 'profile_completed', completed: false } }), 'irondrobe', META, NOW + 1000));
  assert.equal(next.name, 'Suresh K');
  assert.equal(next.sync?.stageLabel, 'Filled shop details');
  assert.deepEqual(next.callHistory, worked.callHistory);
  assert.deepEqual([next.ownerAgentId, next.lead, next.customerType, next.language, next.queue, next.stageTag], ['agent-1', 'positive', 'Shop owner', 'English', 'followup', 'Interested']);
  assert.deepEqual(next.callback, worked.callback);
});

test('a customer nobody has worked yet moves between lists as the product’s data changes', () => {
  const first = ok(applySource(undefined, src({ registered_at: iso(2), onboarding: { stage: 'registered', completed: false } }), 'irondrobe', META, NOW));
  const later = ok(applySource(first, src({ registered_at: iso(2), last_active_at: iso(0), onboarding: { stage: 'registered', completed: false } }), 'irondrobe', META, NOW + 10 * DAY));
  assert.equal(later.queue, 'errors');
  assert.equal(later.stageTag, 'Signed up');
});

test('the plan follows the product only when the product’s plan changes, so “mark paid” sticks', () => {
  const first = ok(applySource(undefined, src(), 'irondrobe', META, NOW));
  assert.deepEqual([first.plan, first.paying], ['Free', false]);
  const marked = { ...first, plan: 'Paid' as const, paying: true };
  const same = ok(applySource(marked, src(), 'irondrobe', META, NOW + 1000));
  assert.deepEqual([same.plan, same.paying], ['Paid', true]);
  const upgraded = ok(applySource(marked, src({ plan: { name: 'monthly', is_paid: true, renews_at: '2026-11-27T00:00:00Z' } }), 'irondrobe', META, NOW + 2000));
  assert.deepEqual([upgraded.plan, upgraded.paying, upgraded.planNote], ['Paid', true, 'monthly · renews 27 Nov 2026']);
  const lapsed = ok(applySource(upgraded, src(), 'irondrobe', META, NOW + 3000));
  assert.deepEqual([lapsed.plan, lapsed.paying, lapsed.planNote], ['Free', false, undefined]);
});

test('a dialled-in or incoming-call record on the same number becomes the product’s customer, calls and all', () => {
  const dd = { ...adHocCustomer('919876543210', 'realbroks', NOW), callHistory: [{ id: 'c1', atLabel: '', atTs: NOW, agentName: 'A', status: 'No Answer' as const, comment: '' }] };
  const c = ok(applySource(dd, src(), 'irondrobe', META, NOW));
  assert.deepEqual([c.id, c.app, c.adHoc, c.name, c.business, c.stageTag], [dd.id, 'irondrobe', false, 'Suresh Kumar', 'Suresh Ironing', 'Created first order']);
  assert.equal(c.callHistory.length, 1);
});

test('a deleted app account stays in TCC but drops out of the lists', () => {
  const first = ok(applySource(undefined, src({ last_active_at: iso(45) }), 'irondrobe', META, NOW));
  assert.equal(first.queue, 'inactive');
  const gone = ok(applySource(first, src({ account_status: 'deleted', last_active_at: iso(45) }), 'irondrobe', META, NOW + 1000));
  assert.deepEqual([gone.active, gone.queue, gone.stageTag, gone.sync?.accountStatus], [false, null, 'Account closed', 'deleted']);
});

test('only the sync time changing is not a change worth sending to every browser', () => {
  const a = ok(applySource(undefined, src(), 'irondrobe', META, NOW));
  const b = ok(applySource(a, src(), 'irondrobe', META, NOW + 60_000));
  assert.equal(sameCustomer(a, b), true);
  const c = ok(applySource(a, src({ usage: { primary_count: 17, secondary_count: 8 } }), 'irondrobe', META, NOW + 60_000));
  assert.equal(sameCustomer(a, c), false);
});

test('two app accounts on one number: TCC follows the open, most recently used one', () => {
  const picked = pickPerNumber([src({ id: 'old', last_active_at: iso(30) }), src({ id: 'new', phone: '09876543210', last_active_at: iso(1) }), src({ id: 'closed', phone: '9876543210', account_status: 'deleted', last_active_at: iso(0) })]);
  assert.equal(picked.size, 1);
  assert.equal(picked.get('9876543210')?.id, 'new');
});

test('a browser saving an older copy can’t undo the sync, but keeps what the agent changed', () => {
  const v1 = ok(applySource(undefined, src({ registered_at: iso(2), onboarding: { stage: 'registered', completed: false } }), 'irondrobe', META, NOW));
  const v2 = ok(applySource(v1, src({ name: 'Suresh K', registered_at: iso(2), plan: { name: 'monthly', is_paid: true }, onboarding: { stage: 'registered', completed: false } }), 'irondrobe', META, NOW + 60_000));
  // The browser still had v1 and the agent only set the owner.
  const saved = keepSourceFields(v2, { ...v1, ownerAgentId: 'agent-2' });
  assert.deepEqual([saved.name, saved.plan, saved.paying, saved.ownerAgentId, saved.sync?.syncedAt], ['Suresh K', 'Paid', true, 'agent-2', NOW + 60_000]);
  // The agent marked them paid on that old copy: their change stands.
  const paid = keepSourceFields({ ...v2, plan: 'Free', paying: false }, { ...v1, plan: 'Paid', paying: true });
  assert.deepEqual([paid.plan, paid.paying], ['Paid', true]);
  // Not linked to a product: untouched.
  const plain = { ...v1, sync: undefined };
  assert.equal(keepSourceFields(plain, { ...plain, name: 'X' }).name, 'X');
});
