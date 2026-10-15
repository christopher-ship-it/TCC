import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTeleCmiWebhook } from '../providers/telecmi/webhook.ts';

// Payloads copied from TeleCMI's published samples (doc.telecmi.com/chub/docs/outgoing-*).
const answeredLegB = {
  virtual_number: '440000000000', call_id: 'c4504776-d91e-123b-29a7-56000429abc3', custom: '{"crm":"true"}', leg: 'b', type: 'cdr', appid: 2222223,
  to: 442000000001, cmiuuid: '0da4f02e-6ece-42e4-989b-1e6766b5a81e', status: 'answered', user: '202_2222223', time: 1650630551178, direction: 'outbound',
  answeredsec: 6, hangup_reason: 'sent_bye', request_id: 'c0Sq3mbykoHgVgLfyWTr6cV6HB5Z0Fk4AXpZFkOClSr', extra_params: '{"click2call":"true"}',
  record: true, filename: '16506305548176941220057791_2222223.mp3',
};
const missed = {
  virtual_number: '440000000000', call_id: 'c4504776-d91e-123b-29a7-56000429abc3', custom: '{"crm":"true"}', leg: 'a', type: 'cdr', appid: 2222223,
  to: 442000000000, cmiuuid: '15b58236-734f-4000-a5e8-78284068f5c7', status: 'missed', user: '202_2222223', time: 1650628175336, direction: 'outbound',
  hangup_reason: 'recv_cancel', request_id: 'D8qpRb27mpXEYgEdAMY6arnQ2ONAB04Y86QrfKbOWZQ', extra_params: '{"click2call":"true"}',
};
const liveStarted = {
  call_id: 'e51d5392-d9cf-123b-fe91-3cecefb9bfb6', leg: 'a', type: 'event', user: '202_2222223', cmiuuid: 'ccd826f9-67a4-4467-acfb-a53093ff5c9d', direction: 'outbound',
  callerid: '442000000000', app_id: 2223343, time: 1650635340436, custom: '{"crm":"true"}', extra_params: '{"click2call":"true"}',
  request_id: 'bvS68LlqtFunYMQO0db6g9klSdfS0UHHDoK9S9Qvaed', status: 'started', to: '442000000001',
};

test('answered CDR: duration, recording, agent, tags', () => {
  const e = normalizeTeleCmiWebhook(answeredLegB);
  assert.ok(e);
  assert.equal(e.kind, 'cdr');
  assert.equal(e.status, 'answered');
  assert.equal(e.leg, 'b');
  assert.equal(e.talkSeconds, 6);
  assert.equal(e.to, '442000000001');
  assert.equal(e.agentUserId, '202_2222223');
  assert.equal(e.agentExtension, '202');
  assert.equal(e.appId, 2222223);
  assert.equal(e.direction, 'outbound');
  assert.equal(e.at, 1650630551178);
  assert.deepEqual(e.recording, { file: '16506305548176941220057791_2222223.mp3' });
  assert.deepEqual(e.meta, { crm: 'true', click2call: 'true' });
});

test('missed CDR has no duration or recording', () => {
  const e = normalizeTeleCmiWebhook(missed);
  assert.ok(e);
  assert.equal(e.status, 'missed');
  assert.equal(e.talkSeconds, null);
  assert.equal(e.recording, null);
  assert.equal(e.hangupReason, 'recv_cancel');
});

test('live event uses app_id and callerid', () => {
  const e = normalizeTeleCmiWebhook(liveStarted);
  assert.ok(e);
  assert.equal(e.kind, 'live');
  assert.equal(e.status, 'started');
  assert.equal(e.appId, 2223343);
  assert.equal(e.from, '442000000000');
});

test('accepts a JSON string body and ignores malformed / foreign payloads', () => {
  assert.equal(normalizeTeleCmiWebhook(JSON.stringify(missed))?.status, 'missed');
  assert.equal(normalizeTeleCmiWebhook('not json'), null);
  assert.equal(normalizeTeleCmiWebhook(null), null);
  assert.equal(normalizeTeleCmiWebhook([]), null);
  assert.equal(normalizeTeleCmiWebhook({ type: 'sms' }), null);
  assert.equal(normalizeTeleCmiWebhook({ type: 'cdr', status: 'answered' }), null); // no ids
});

test('unknown status is preserved as "other"; bad tag JSON yields empty meta', () => {
  const e = normalizeTeleCmiWebhook({ ...missed, status: 'voicemail', custom: '{oops', extra_params: undefined });
  assert.equal(e?.status, 'other');
  assert.equal(e?.rawStatus, 'voicemail');
  assert.deepEqual(e?.meta, {});
});
