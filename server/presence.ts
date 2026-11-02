// An agent's availability in TeleCMI (online / offline). TeleCMI's teams only ring agents whose status is
// online, and the browser softphone signing in does not change that status — so an agent could be on the line
// and still never get an incoming call. Setting it needs the App Secret, which is why it lives on the server.
//
// The browser proves it is that agent by sending the softphone login it just used; it is checked against
// TeleCMI's own user login and never stored or logged.

import type { ServerEnv } from './env.ts';

const REST = 'https://rest.telecmi.com/v2';

export type AgentStatus = 'online' | 'offline';

export class PresenceError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function post(url: string, body: unknown, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new PresenceError('The phone provider could not be reached.', 502);
  }
  try {
    return ((await res.json()) ?? {}) as Record<string, unknown>;
  } catch {
    throw new PresenceError(`The phone provider answered ${res.status} with no readable body.`, 502);
  }
}

/** Set a softphone user's status. Only users of this deployment's TeleCMI app, and only with their own password. */
export async function setAgentStatus(input: { id?: unknown; password?: unknown; status?: unknown }, env: ServerEnv, fetchImpl: typeof fetch = fetch): Promise<AgentStatus> {
  if (!env.telecmiAppId || !env.telecmiSecret) throw new PresenceError('Agent status needs TELECMI_APP_SECRET on the server.', 501);
  const { id, password, status } = input;
  if (status !== 'online' && status !== 'offline') throw new PresenceError('status must be online or offline.', 400);
  if (typeof id !== 'string' || typeof password !== 'string' || !password) throw new PresenceError('id and password are required.', 400);
  const m = /^(\d{1,8})_(\d{4,12})$/.exec(id);
  if (!m || m[2] !== env.telecmiAppId) throw new PresenceError('That softphone user is not part of this phone line.', 403);

  // TeleCMI reports a bad login as HTTP 200 with {code: 404} — only a token counts.
  const login = await post(`${REST}/user/login`, { id, password }, fetchImpl);
  if (typeof login.token !== 'string') throw new PresenceError('Softphone user or password was not accepted.', 401);

  const out = await post(`${REST}/user/status`, { appid: Number(env.telecmiAppId), secret: env.telecmiSecret, id, status }, fetchImpl);
  if (out.code !== 200) throw new PresenceError(`The phone provider refused the status change (${String(out.code ?? 'no code')}: ${String(out.msg ?? out.message ?? 'no message')}).`, 502);
  return status;
}
