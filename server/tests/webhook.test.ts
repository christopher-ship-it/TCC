import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCdrWebhook, pickRecordedCall, webhookAuthorised } from '../webhook.ts';

const outbound = {
  type: 'cdr',
  direction: 'outbound',
  status: 'answered',
  user: '5002_33338836',
  from: '917943446011',
  to: 919342132678,
  time: 1793345391722,
  answeredsec: 67,
  record: true,
  filename: '1793345391722_1000010910842_5002_33338836.wav',
};

test('an outbound CDR with a recording is kept under the number that was called', () => {
  const r = parseCdrWebhook(outbound)!;
  assert.equal(r.file, outbound.filename);
  assert.equal(r.remote, '9342132678');
  assert.equal(r.direction, 'outbound');
  assert.equal(r.startedAt, 1793345391722);
  assert.equal(r.talkSeconds, 67);
});

test('an inbound CDR is kept under the caller, and a time in seconds becomes milliseconds', () => {
  const r = parseCdrWebhook({ ...outbound, direction: 'inbound', from: '919342132678', to: '918270942966', time: 1793345391 })!;
  assert.equal(r.remote, '9342132678');
  assert.equal(r.startedAt, 1793345391000);
});

test('payloads without a usable recording are ignored', () => {
  assert.equal(parseCdrWebhook({ ...outbound, record: false }), null);
  assert.equal(parseCdrWebhook({ ...outbound, filename: undefined }), null);
  assert.equal(parseCdrWebhook({ ...outbound, filename: '../etc/passwd' }), null);
  assert.equal(parseCdrWebhook({ ...outbound, type: 'event' }), null);
  assert.equal(parseCdrWebhook('not json'), null);
  assert.equal(parseCdrWebhook(JSON.stringify(outbound))?.file, outbound.filename);
});

test('the webhook secret fails closed', () => {
  assert.equal(webhookAuthorised('abc', undefined), false);
  assert.equal(webhookAuthorised(undefined, 'abc'), false);
  assert.equal(webhookAuthorised('abd', 'abc'), false);
  assert.equal(webhookAuthorised('abc', 'abc'), true);
});

test('the recording is the closest one to the same number, and never one already used', () => {
  const near = parseCdrWebhook(outbound)!;
  const far = { ...near, file: 'other.wav', startedAt: near.startedAt + 120_000 };
  const elsewhere = { ...near, file: 'x.wav', remote: '9999999999' };
  const q = { remote: '919342132678', startedAt: near.startedAt - 3500, direction: 'outbound' };
  assert.equal(pickRecordedCall([far, elsewhere, near], q), near.file);
  assert.equal(pickRecordedCall([far, near], q, new Set([near.file])), far.file);
  assert.equal(pickRecordedCall([near], { ...q, startedAt: near.startedAt + 10 * 60_000 }), undefined);
  assert.equal(pickRecordedCall([near], { ...q, direction: 'inbound' }), undefined);
});
