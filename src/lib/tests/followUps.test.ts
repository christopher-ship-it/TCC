import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_FOLLOWUP_DAYS, dayFromInput, inputFromDay, planFollowUp, startOfDay } from '../followUps.ts';

const DAY = 86_400_000;
const t0 = new Date(2026, 9, 21, 10, 50).getTime();

test('a first unanswered call starts the daily chain for tomorrow', () => {
  const p = planFollowUp({ answered: false, hadAnswered: false, auto: undefined, now: t0 });
  assert.equal(p.callback?.dueTs, startOfDay(t0) + DAY);
  assert.equal(p.callback?.auto, true);
  assert.equal(p.autoFollowUp?.attempts, 1);
  assert.equal(p.ended, false);
});

test('answering stops the automatic calls', () => {
  const auto = { startedTs: startOfDay(t0), attempts: 3 };
  const p = planFollowUp({ answered: true, hadAnswered: false, auto, now: t0 + 3 * DAY });
  assert.equal(p.callback, undefined);
  assert.equal(p.autoFollowUp, undefined);
  assert.equal(p.ended, false);
});

test('the chain ends when the 14 days are used up', () => {
  const auto = { startedTs: startOfDay(t0), attempts: 13 };
  const day13 = planFollowUp({ answered: false, hadAnswered: false, auto, now: t0 + 13 * DAY });
  assert.equal(day13.ended, false);
  const day14 = planFollowUp({ answered: false, hadAnswered: false, auto, now: t0 + AUTO_FOLLOWUP_DAYS * DAY });
  assert.equal(day14.ended, true);
  assert.equal(day14.callback, undefined);
});

test('an agent-chosen date wins, including today, and the chain keeps counting', () => {
  const p = planFollowUp({ answered: false, hadAnswered: false, auto: undefined, manualTs: t0, now: t0 });
  assert.deepEqual(p.callback, { dueTs: startOfDay(t0), auto: false });
  assert.equal(p.autoFollowUp?.attempts, 1);
});

test('someone already reached before gets no automatic chain, only a date if chosen', () => {
  assert.equal(planFollowUp({ answered: false, hadAnswered: true, auto: undefined, now: t0 }).callback, undefined);
  assert.equal(planFollowUp({ answered: true, hadAnswered: true, auto: undefined, manualTs: t0 + 5 * DAY, now: t0 }).callback?.auto, false);
});

test('dates round-trip through the date input', () => {
  assert.equal(inputFromDay(dayFromInput('2026-10-24')!), '2026-10-24');
  assert.equal(dayFromInput('nope'), undefined);
});

test('follow-up list: call-back dates win over the weekly chain, deleted customers are left out, earliest first', async () => {
  const { scheduledFollowUps } = await import('../followUps.ts');
  const base = { name: 'x', deleted: undefined } as never as import('../../data/types.ts').CustomerUser;
  const users = [
    { ...base, id: 'a', name: 'A', callback: { dueTs: t0 + 3 * DAY, auto: false }, followUp: { weekNumber: 1, nextDueLabel: '', nextDueTs: t0 + DAY, markedPositiveLabel: '', state: 'pending' as const } },
    { ...base, id: 'b', name: 'B', followUp: { weekNumber: 1, nextDueLabel: '', nextDueTs: t0 + 2 * DAY, markedPositiveLabel: '', state: 'pending' as const } },
    { ...base, id: 'c', name: 'C', callback: { dueTs: t0 - DAY, auto: true } },
    { ...base, id: 'd', name: 'D', callback: { dueTs: t0, auto: false }, deleted: { byId: '', byName: '', reason: '', ts: 0, atLabel: '' } },
    { ...base, id: 'e', name: 'E' },
  ];
  const list = scheduledFollowUps(users);
  assert.deepEqual(list.map((f) => [f.user.id, f.kind]), [['c', 'auto'], ['b', 'weekly'], ['a', 'agent']]);
  assert.equal(list[0].dueTs, startOfDay(t0 - DAY));
});

test('date filters: today, tomorrow, this week (to Sunday), overdue and a custom range', async () => {
  const { rangeBounds, inRange, addDays } = await import('../followUps.ts');
  const wed = new Date(2026, 9, 21, 15, 0).getTime(); // Wednesday 21 Oct 2026
  const today = startOfDay(wed);
  assert.deepEqual(rangeBounds('today', wed), { from: today, to: addDays(today, 1) });
  assert.deepEqual(rangeBounds('tomorrow', wed), { from: addDays(today, 1), to: addDays(today, 2) });
  const week = rangeBounds('week', wed);
  assert.equal(new Date(week.to - 1).getDay(), 0, 'the week ends on Sunday');
  assert.equal(week.to, addDays(today, 5));
  const sun = new Date(2026, 9, 25, 9).getTime();
  assert.equal(rangeBounds('week', sun).to, addDays(startOfDay(sun), 1), 'on a Sunday, this week is just today');
  assert.ok(inRange(addDays(today, -3), rangeBounds('overdue', wed)));
  assert.ok(!inRange(today, rangeBounds('overdue', wed)));
  const custom = rangeBounds('custom', wed, { from: addDays(today, 2), to: addDays(today, 4) });
  assert.ok(inRange(addDays(today, 4), custom), 'the last day of a custom range is included');
  assert.ok(!inRange(addDays(today, 5), custom));
  assert.ok(!inRange(addDays(today, 1), custom));
});

test('an older weekly chain with no stored date is due a week after the last positive call', async () => {
  const { scheduledFollowUps, addDays } = await import('../followUps.ts');
  const u = {
    id: 'old', name: 'Old', callHistory: [{ id: 'c2', atTs: t0, status: 'No Answer' }, { id: 'c1', atTs: t0 - 2 * DAY, status: 'Answered — Followup', outcome: 'Interested' }],
    followUp: { weekNumber: 1, nextDueLabel: '', markedPositiveLabel: '', state: 'pending' },
  } as never as import('../../data/types.ts').CustomerUser;
  const [f] = scheduledFollowUps([u]);
  assert.equal(f.kind, 'weekly');
  assert.equal(f.dueTs, addDays(t0 - 2 * DAY, 7));
});
