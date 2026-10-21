import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallLogEntry } from '../../data/types.ts';
import { whyNotAnswered } from '../whyNotAnswered.ts';

const call = (disposition: string, direction?: 'inbound', ringSec = 9): CallLogEntry =>
  ({ id: 'c', atLabel: '', atTs: 0, agentName: 'Vimal', status: 'No Answer', comment: '', telephony: { provider: 'telecmi', callId: null, durationSec: 0, ringSec, disposition, direction } }) as CallLogEntry;

test('a missed incoming call says who did not pick up and that the caller gave up', () => {
  const r = whyNotAnswered(call('no-answer', 'inbound'));
  assert.equal(r.result, 'No answer');
  assert.match(r.why, /rang for 9s on Vimal’s line/);
  assert.match(r.next, /call back/);
});

test('outgoing calls explain busy, unreachable and declined differently', () => {
  assert.match(whyNotAnswered(call('busy')).why, /busy/);
  assert.equal(whyNotAnswered(call('unreachable')).result, 'Not reachable');
  assert.match(whyNotAnswered(call('rejected')).why, /customer declined/);
  assert.match(whyNotAnswered(call('no-answer')).next, /another try/);
});
