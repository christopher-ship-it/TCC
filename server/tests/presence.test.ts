import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
import { readServerEnv } from '../env.ts';
import { PresenceError, setAgentStatus } from '../presence.ts';

const env = readServerEnv({ VITE_TELECMI_APP_ID: '33338836', TELECMI_APP_SECRET: 's3cret' }, os.tmpdir());

function fakeTeleCmi(opts: { loginOk?: boolean; statusCode?: number } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith('/user/login')) return new Response(JSON.stringify(opts.loginOk === false ? { code: 404, msg: 'invalid' } : { code: 200, token: 't' }));
    return new Response(JSON.stringify({ code: opts.statusCode ?? 200, status: body.status, msg: 'status updated successfully' }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const rejectsWith = (p: Promise<unknown>, status: number) => assert.rejects(p, (e: unknown) => e instanceof PresenceError && e.status === status);

test('checks the agent’s own login, then sets the status with the app secret', async () => {
  const t = fakeTeleCmi();
  assert.equal(await setAgentStatus({ id: '5002_33338836', password: 'pw', status: 'online' }, env, t.fetchImpl), 'online');
  assert.deepEqual(t.calls[0], { url: 'https://rest.telecmi.com/v2/user/login', body: { id: '5002_33338836', password: 'pw' } });
  assert.deepEqual(t.calls[1], { url: 'https://rest.telecmi.com/v2/user/status', body: { appid: 33338836, secret: 's3cret', id: '5002_33338836', status: 'online' } });
});

test('refuses a wrong password, another app’s user, a bad status, and a missing secret', async () => {
  const bad = fakeTeleCmi({ loginOk: false });
  await rejectsWith(setAgentStatus({ id: '5002_33338836', password: 'nope', status: 'online' }, env, bad.fetchImpl), 401);
  assert.equal(bad.calls.length, 1, 'no status change after a failed login');

  const t = fakeTeleCmi();
  await rejectsWith(setAgentStatus({ id: '5002_99999999', password: 'pw', status: 'online' }, env, t.fetchImpl), 403);
  await rejectsWith(setAgentStatus({ id: '5002_33338836', password: 'pw', status: 'break' }, env, t.fetchImpl), 400);
  await rejectsWith(setAgentStatus({ id: '5002_33338836', status: 'online' }, env, t.fetchImpl), 400);
  assert.equal(t.calls.length, 0);

  await rejectsWith(setAgentStatus({ id: '5002_33338836', password: 'pw', status: 'online' }, readServerEnv({ VITE_TELECMI_APP_ID: '33338836' }, os.tmpdir()), t.fetchImpl), 501);
});

test('a refused status change is reported without the secret', async () => {
  const t = fakeTeleCmi({ statusCode: 401 });
  await assert.rejects(setAgentStatus({ id: '5002_33338836', password: 'pw', status: 'offline' }, env, t.fetchImpl), (e: Error) => e instanceof PresenceError && e.status === 502 && !e.message.includes('s3cret'));
});
