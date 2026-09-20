import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallLogEntry, CustomerUser } from '../../data/types.ts';
import { attachRecording } from '../attachRecording.ts';

const NOW = 1_800_000_000_000;

function entry(id: string, atTs: number, telephony?: CallLogEntry['telephony']): CallLogEntry {
  return { id, atTs, atLabel: '', agentName: 'A', status: 'Answered — DG', comment: '', telephony };
}
const tel = (callId: string, extra: object = {}) => ({ provider: 'telecmi', callId, durationSec: 10, ringSec: 2, disposition: 'connected', ...extra });
const user = (id: string, callHistory: CallLogEntry[]) => ({ id, callHistory }) as unknown as CustomerUser;
const URL_OF = (f: string) => `https://host/dl/${f}`;

test('matches by the provider call id when known', () => {
  const users = [user('u1', [entry('a', NOW - 1000, tel('X'))]), user('u2', [entry('b', NOW - 500, tel('Y'))])];
  const hit = attachRecording(users, 'r.mp3', URL_OF('r.mp3'), 'X', NOW);
  assert.equal(hit?.userId, 'u1');
  assert.equal(hit?.callHistory[0].telephony?.recordingFile, 'r.mp3');
  assert.equal(hit?.callHistory[0].telephony?.recordingUrl, 'https://host/dl/r.mp3');
});

test('without a call id, falls back to the newest recent real call that has no recording', () => {
  const users = [user('u1', [entry('old', NOW - 60_000, tel('X'))]), user('u2', [entry('new', NOW - 5_000, tel('Y'))])];
  assert.equal(attachRecording(users, 'r.mp3', URL_OF('r.mp3'), undefined, NOW)?.userId, 'u2');
});

test('an id that matches nothing still falls back to the newest recent call', () => {
  const users = [user('u1', [entry('a', NOW - 5_000, tel('X'))])];
  assert.equal(attachRecording(users, 'r.mp3', URL_OF('r.mp3'), 'unknown', NOW)?.userId, 'u1');
});

test('never touches calls that already have a recording, are not real softphone calls, or are too old', () => {
  const users = [
    user('has', [entry('a', NOW - 1000, tel('X', { recordingFile: 'have.mp3' }))]),
    user('manual', [entry('b', NOW - 1000)]),
    user('demo', [entry('c', NOW - 1000, { ...tel('D'), provider: 'demo' })]),
    user('stale', [entry('d', NOW - 16 * 60_000, tel('S'))]),
  ];
  assert.equal(attachRecording(users, 'r.mp3', URL_OF('r.mp3'), undefined, NOW), null);
});

test('only the matched entry changes; the customer\'s other entries are untouched', () => {
  const other = entry('other', NOW - 900_000, tel('O'));
  const target = entry('target', NOW - 1000, tel('T'));
  const hit = attachRecording([user('u', [target, other])], 'r.mp3', URL_OF('r.mp3'), 'T', NOW);
  assert.equal(hit?.callHistory[1], other);
  assert.equal(hit?.callHistory[0].telephony?.recordingFile, 'r.mp3');
});

test('withTranscript sets the transcript on exactly one entry', async () => {
  const { withTranscript } = await import('../attachRecording.ts');
  const a = entry('a', NOW), b = entry('b', NOW);
  const t = { text: 'hi', segments: [], model: 'm', at: 1, source: 'whisper-local' as const };
  const out = withTranscript([a, b], 'b', t);
  assert.equal(out[0], a);
  assert.equal(out[1].transcript, t);
});

test('an exact entry id targets that entry only, regardless of age or call id', async () => {
  const { attachRecording: attach } = await import('../attachRecording.ts');
  const users = [user('u1', [entry('old', NOW - 5 * 3600_000, tel('X')), entry('new', NOW - 1000, tel('Y'))])];
  const hit = attach(users, 'r.mp3', URL_OF('r.mp3'), undefined, NOW, 'old');
  assert.equal(hit?.callHistory[0].telephony?.recordingFile, 'r.mp3');
  assert.equal(hit?.callHistory[1].telephony?.recordingFile, undefined);
  assert.equal(attach(users, 'r.mp3', URL_OF('r.mp3'), undefined, NOW, 'nope'), null);
});

test('legacy cleanup removes invented recordings and template analytics from real calls only', async () => {
  const { cleanLegacyCallData } = await import('../attachRecording.ts');
  const fakeAnalytics = { sentiment: 'neutral', sentimentScore: 0.15, summary: 'Real call', keyTopics: [], actionItems: [], transcript: [], source: 'server_webhook' };
  const real = { ...entry('real', NOW, { ...tel('C'), recordingFile: 'rec_123.wav', recordingUrl: 'https://old' }), analytics: fakeAnalytics } as unknown as CallLogEntry;
  const good = entry('good', NOW, { ...tel('D'), recordingFile: '1789_1_5002_1.mp3' });
  const demo = { ...entry('demo', NOW, { ...tel('E'), provider: 'demo', recordingFile: 'rec_9.wav' }), analytics: { ...fakeAnalytics, source: 'simulation' } } as unknown as CallLogEntry;
  const users = [user('u', [real, good, demo])];
  const out = cleanLegacyCallData(users);
  assert.equal(out[0].callHistory[0].analytics, undefined);
  assert.equal(out[0].callHistory[0].telephony?.recordingFile, undefined);
  assert.equal(out[0].callHistory[0].telephony?.recordingUrl, undefined);
  assert.equal(out[0].callHistory[1], good);
  assert.equal(out[0].callHistory[2], demo);
  assert.equal(cleanLegacyCallData(out), out); // nothing left to clean → same reference
});
