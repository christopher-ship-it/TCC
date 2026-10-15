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

test('withAnalysis sets the analysis on exactly one entry and clears a stale error', async () => {
  const { withAnalysis } = await import('../attachRecording.ts');
  const a = entry('a', NOW), b = { ...entry('b', NOW), analysisError: 'offline' };
  const analysis = { source: 'gemini' as const, at: 1, summary: 's', keyPoints: [], objections: [], actionItems: [], sentiment: 70, languages: [], transcript: [] };
  const out = withAnalysis([a, b], 'b', analysis);
  assert.equal(out[0], a);
  assert.equal(out[1].analysis, analysis);
  assert.equal(out[1].analysisError, undefined);
  assert.equal(withAnalysis(out, 'b', undefined, 'boom')[1].analysis, analysis);
});

test('an exact entry id targets that entry only, regardless of age or call id', async () => {
  const { attachRecording: attach } = await import('../attachRecording.ts');
  const users = [user('u1', [entry('old', NOW - 5 * 3600_000, tel('X')), entry('new', NOW - 1000, tel('Y'))])];
  const hit = attach(users, 'r.mp3', URL_OF('r.mp3'), undefined, NOW, 'old');
  assert.equal(hit?.callHistory[0].telephony?.recordingFile, 'r.mp3');
  assert.equal(hit?.callHistory[1].telephony?.recordingFile, undefined);
  assert.equal(attach(users, 'r.mp3', URL_OF('r.mp3'), undefined, NOW, 'nope'), null);
});

test('legacy cleanup drops invented data from real calls and converts demo and Whisper data to analysis', async () => {
  const { cleanLegacyCallData } = await import('../attachRecording.ts');
  const fakeAnalytics = { sentiment: 'neutral', sentimentScore: 0.2, summary: 'Real call', keyTopics: ['annual_plan'], actionItems: [], transcript: [{ speaker: 'agent', text: 'hi', offsetSec: 3 }], source: 'server_webhook' };
  const real = { ...entry('real', NOW, { ...tel('C'), recordingFile: 'rec_123.wav', recordingUrl: 'https://old' }), analytics: fakeAnalytics } as unknown as CallLogEntry;
  const good = entry('good', NOW, { ...tel('D'), recordingFile: '1789_1_5002_1.mp3' });
  const demo = { ...entry('demo', NOW, { ...tel('E'), provider: 'demo', recordingFile: 'rec_9.wav' }), analytics: { ...fakeAnalytics, source: 'simulation' } } as unknown as CallLogEntry;
  const whisper = { ...entry('w', NOW, { ...tel('F'), recordingFile: '1790_1.mp3' }), transcript: { text: 'x', segments: [{ start: 1, end: 2, text: 'x' }], model: 'm', at: 5 } } as unknown as CallLogEntry;
  const out = cleanLegacyCallData([user('u', [real, good, demo, whisper])]);
  const [r, g, d, w] = out[0].callHistory;
  assert.equal(r.analysis, undefined);
  assert.equal(r.telephony?.recordingFile, undefined);
  assert.equal(r.telephony?.recordingUrl, undefined);
  assert.equal(g, good);
  assert.equal(d.analysis?.source, 'sample');
  assert.equal(d.analysis?.sentiment, 60);
  assert.deepEqual(d.analysis?.keyPoints, ['annual plan']);
  assert.equal(d.analysis?.transcript[0].atSec, 3);
  assert.equal(w.analysis?.source, 'whisper');
  assert.equal(w.analysis?.transcript[0].text, 'x');
  assert.equal(cleanLegacyCallData(out), out); // nothing left to clean → same reference
});
