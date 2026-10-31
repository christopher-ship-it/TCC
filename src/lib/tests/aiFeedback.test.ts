import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLessons, outcomeDisagrees, parseFeedback, summarize, type FeedbackRow } from '../aiFeedback.ts';
import { analysisPrompt } from '../analysis/model.ts';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const DAY = 86_400_000;
let n = 0;
const row = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({ id: `r${n++}`, entryId: `e${n}`, app: 'irondrobe', agentId: 'a1', ts: NOW - DAY, kind: 'manual', verdict: 'good', aiOutcome: 'Interested', aiSentiment: 70, language: 'Tamil', ...over });

test('a browser’s feedback is checked and stored under the signed-in agent, never one it names', () => {
  const ok = parseFeedback({ entryId: 'cl-1', app: 'irondrobe', verdict: 'wrong', aiOutcome: 'Interested', outcome: 'Not interested', sentiment: 'negative', note: '  They said no politely  ', agentId: 'someone-else' }, { id: 'a1' }, NOW);
  assert.ok(typeof ok !== 'string');
  if (typeof ok !== 'string') {
    assert.equal(ok.agentId, 'a1');
    assert.equal(ok.id, 'manual:cl-1');
    assert.equal(ok.note, 'They said no politely');
    assert.equal(ok.sentiment, 'negative');
  }
  assert.equal(typeof parseFeedback({ app: 'irondrobe', verdict: 'good' }, { id: 'a1' }), 'string');
  assert.equal(typeof parseFeedback({ entryId: 'x', app: 'irondrobe', verdict: 'great' }, { id: 'a1' }), 'string');
  const implicit = parseFeedback({ entryId: 'call-9', app: 'irondrobe', verdict: 'good', kind: 'implicit' }, { id: 'a1' });
  assert.ok(typeof implicit !== 'string' && implicit.id === 'implicit:call-9', 'one per call per kind, so sending twice replaces rather than doubles');
});

test('accuracy is the share the team marked good, and outcome agreement compares what each side chose', () => {
  const s = summarize([row(), row(), row({ verdict: 'wrong', outcome: 'Not interested' }), row({ verdict: 'partly', outcome: 'Call back later' })], NOW);
  assert.equal(s.total, 4);
  assert.equal(s.accuracy, 50);
  assert.deepEqual(s.verdicts, { good: 2, partly: 1, wrong: 1 });
  assert.equal(s.outcomeAgreement.known, 4);
  assert.equal(s.outcomeAgreement.agreed, 2);
  assert.equal(s.byOutcome[0].topCorrection === 'Not interested' || s.byOutcome[0].topCorrection === 'Call back later', true);
  assert.equal(outcomeDisagrees(row({ verdict: 'wrong', outcome: 'Not interested' })), true);
  assert.equal(outcomeDisagrees(row({ verdict: 'wrong' })), false, 'wrong with no correction says nothing about the outcome');
});

test('shows whether accuracy is improving: the last 4 weeks against the 4 before', () => {
  const rows: FeedbackRow[] = [];
  for (let i = 0; i < 8; i++) rows.push(row({ ts: NOW - (30 + i) * DAY, verdict: i < 3 ? 'good' : 'wrong' })); // 5 weeks back: 3 of 8 good
  for (let i = 0; i < 8; i++) rows.push(row({ ts: NOW - (3 + i) * DAY, verdict: i < 6 ? 'good' : 'wrong' })); // recent: 6 of 8 good
  const s = summarize(rows, NOW);
  assert.equal(s.weekly.length, 12);
  assert.ok(s.trend !== null && s.trend > 0, `trend ${s.trend}`);
  assert.equal(summarize([row()], NOW).trend, null, 'too little to compare');
});

test('notices when the AI is too hopeful about customers', () => {
  const rows = Array.from({ length: 8 }, () => row({ aiSentiment: 80, sentiment: 'neutral', verdict: 'partly' }));
  const s = summarize(rows, NOW);
  assert.equal(s.bias.tooHigh, 8);
  assert.match(buildLessons(rows), /more receptive than the team does/);
});

test('turns repeated corrections into a lesson, and recent notes into examples', () => {
  const rows = [
    ...Array.from({ length: 4 }, () => row({ aiOutcome: 'Very interested', verdict: 'wrong', outcome: 'Call back later' })),
    row({ aiOutcome: 'Very interested' }),
    row({ aiOutcome: 'Interested', verdict: 'wrong', outcome: 'Not interested', note: 'Polite "ok ok" is not interest, he never asked about price' }),
  ];
  const lessons = buildLessons(rows);
  assert.match(lessons, /chose "Very interested", the team disagreed 4 of 5 times, most often choosing "Call back later"/);
  assert.match(lessons, /Polite "ok ok" is not interest/);
  assert.ok(lessons.length <= 1400);
});

test('says nothing when there is too little feedback, and never includes customer details', () => {
  assert.equal(buildLessons([row(), row()]), '');
  assert.equal(buildLessons([]), '');
  const out = buildLessons([row({ aiOutcome: 'Interested', verdict: 'wrong', outcome: 'Not interested', note: 'no' })]);
  assert.doesNotMatch(out, /\+91|customer name/i);
});

test('the lessons reach the instructions only when there are some', () => {
  assert.doesNotMatch(analysisPrompt({ customer: 'X' }), /Lessons from this team/);
  const p = analysisPrompt({ customer: 'X', lessons: '- Be careful with "Interested".' });
  assert.match(p, /Lessons from this team's corrections/);
  assert.match(p, /Be careful with "Interested"/);
});
