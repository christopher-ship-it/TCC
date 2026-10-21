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
