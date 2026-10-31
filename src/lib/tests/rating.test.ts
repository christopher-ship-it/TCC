import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RATING_DAYS, priorityRank, scheduledFollowUps, startOfDay } from '../followUps.ts';
import type { CustomerUser } from '../../data/types.ts';

const now = new Date(2026, 9, 31, 11, 0).getTime();

const customer = (id: string, extra: Partial<CustomerUser> = {}): CustomerUser =>
  ({ id, name: id, app: 'irondrobe', phone: '+919000000000', callHistory: [], attempt: 0, queue: 'new', tickets: [], ...extra }) as unknown as CustomerUser;

test('a better grade is called back later: Good 7 days, Average 5, Okay 3', () => {
  assert.deepEqual(RATING_DAYS, { Good: 7, Average: 5, Okay: 3 });
});

test('High priority comes before Medium, Low last, unranked in between', () => {
  const ranks = (['High', 'Medium', undefined, 'Low'] as const).map(priorityRank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('on the same day High priority is listed first', () => {
  const due = startOfDay(now);
  const mk = (id: string, priority?: 'High' | 'Medium' | 'Low') => customer(id, { priority, callback: { dueTs: due, auto: false } });
  const out = scheduledFollowUps([mk('a-low', 'Low'), mk('b-none'), mk('c-high', 'High'), mk('d-med', 'Medium')]);
  assert.deepEqual(out.map((f) => f.user.id), ['c-high', 'd-med', 'b-none', 'a-low']);
});
