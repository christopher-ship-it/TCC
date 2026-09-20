import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchOutgoingCdr, fetchUserToken, parseCdr, pickRecording } from '../providers/telecmi/cdr.ts';

const T0 = 1_789_896_093_389; // a real call start from the account's history
const rec = (filename: string, time: number, to = '918270942966', duration = 30) => ({ cmiuid: 'u-' + filename, filename, record: true, to, time, duration });

test('parses either envelope, skips records without a recording, normalises seconds to ms', () => {
  assert.equal(parseCdr({ code: 200, cdr: [rec('a.mp3', T0)] })[0].filename, 'a.mp3');
  assert.equal(parseCdr({ data: [rec('b.mp3', T0)] })[0].filename, 'b.mp3');
  assert.equal(parseCdr([rec('c.mp3', T0)])[0].filename, 'c.mp3');
  assert.equal(parseCdr({ cdr: [{ ...rec('d.mp3', T0), record: false }, { to: 1, time: T0 }] }).length, 0);
  assert.equal(parseCdr({ cdr: [rec('s.mp3', Math.floor(T0 / 1000))] })[0].timeMs, Math.floor(T0 / 1000) * 1000);
  assert.deepEqual(parseCdr(null), []);
  assert.deepEqual(parseCdr({ code: 404 }), []);
});

test('picks the recording for the same number that started closest to the call', () => {
  const entries = parseCdr({ cdr: [rec('near.mp3', T0 + 2_000), rec('other-number.mp3', T0, '919999999999'), rec('older.mp3', T0 - 100_000)] });
  assert.equal(pickRecording(entries, { remote: '+91 82709 42966', startedAt: T0 }), 'near.mp3');
});

test('call length breaks ties between back-to-back calls; claimed files are never reused', () => {
  const entries = parseCdr({ cdr: [rec('first.mp3', T0 - 30_000, undefined, 38), rec('second.mp3', T0 + 1_000, undefined, 12)] });
  assert.equal(pickRecording(entries, { remote: '918270942966', startedAt: T0 - 20_000, talkSeconds: 38 }), 'first.mp3');
  assert.equal(pickRecording(entries, { remote: '918270942966', startedAt: T0, talkSeconds: 12 }, new Set(['second.mp3'])), 'first.mp3');
});

test('nothing plausible → undefined (wrong number, too far in time, no time)', () => {
  const entries = parseCdr({ cdr: [rec('x.mp3', T0 + 10 * 60_000), rec('y.mp3', T0, '911111111111'), { filename: 'z.mp3', to: '918270942966' }] });
  assert.equal(pickRecording(entries, { remote: '918270942966', startedAt: T0 }), undefined);
});

test('login + out_cdr call the documented endpoints with the documented fields (fetch is injected)', async () => {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, body });
    return url.endsWith('/user/login')
      ? new Response(JSON.stringify({ code: 200, token: 'tok-1' }), { status: 200 })
      : new Response(JSON.stringify({ code: 200, cdr: [rec('f.mp3', T0)] }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await fetchUserToken('5002_1', 'pw', fake), 'tok-1');
  const list = await fetchOutgoingCdr('tok-1', T0 - 1, T0 + 1, fake);
  assert.equal(list[0].filename, 'f.mp3');
  assert.deepEqual(seen[0], { url: 'https://rest.telecmi.com/v2/user/login', body: { id: '5002_1', password: 'pw' } });
  assert.deepEqual(seen[1], { url: 'https://rest.telecmi.com/v2/user/out_cdr', body: { type: 1, token: 'tok-1', from: T0 - 1, to: T0 + 1, page: 1, limit: 10 } });
});

test('login failures and bad responses degrade quietly', async () => {
  const bad = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
  assert.equal(await fetchUserToken('x', 'y', bad), null);
  const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal(await fetchUserToken('x', 'y', boom), null);
  await assert.rejects(fetchOutgoingCdr('t', 0, 1, bad), /404/);
});

test('TeleCMI reports failures as HTTP 200 + {error:true}: a bad token is an error, never "no records"', async () => {
  const authFail = (async () => new Response(JSON.stringify({ error: true, code: 404, message: 'Failed to authenticate token.' }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(fetchOutgoingCdr('bad', 0, 1, authFail), /404: Failed to authenticate token/);
  const loginFail = (async () => new Response(JSON.stringify({ error: true, code: 404, msg: 'Authentication Failed' }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await fetchUserToken('x', 'y', loginFail), null);
});
