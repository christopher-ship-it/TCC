// "Is it safe to put real clients on this?" — the checks an admin should be able to read at a glance. Pure: the page
// passes in what it knows (people, customers, which line is switched on, what the server reports) and shows the result.
import type { AgentAccount, CustomerUser } from '../data/types.ts';
import { normalizePhone } from '../telephony/core/phone-number.ts';
import { can, isActive } from './access.ts';
import { isReachable } from './queue.ts';
import { countByOrigin, originOf, realCustomersOwnedByDemo } from './world.ts';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, when it is not a pass. */
  fix?: string;
  /** Where in the app to do it. */
  to?: string;
}

export interface ServerReport {
  analysis?: boolean;
  recordings?: boolean;
}

export interface ReadinessInput {
  backend: 'local' | 'firestore';
  users: CustomerUser[];
  agents: AgentAccount[];
  telephony: { provider: 'telecmi' | 'mock' | null; testNumber: string | null; live: boolean };
  /** What /api/health said, or null when the server could not be reached. */
  server: ServerReport | null;
  appName: (id: string) => string;
}

export interface Readiness {
  checks: Check[];
  failed: number;
  warned: number;
  verdict: 'blocked' | 'caution' | 'ready';
}

const n = (x: number) => x.toLocaleString('en-IN');
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

export function runChecks(input: ReadinessInput): Readiness {
  const { backend, users, agents, telephony, server, appName } = input;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const real = users.filter((u) => originOf(u) === 'app');
  const realAgents = agents.filter((a) => !a.demo && isActive(a) && a.role === 'agent');
  const demoAgents = agents.filter((a) => a.demo && isActive(a));
  const callers = realAgents.filter((a) => a.queues.length > 0 && a.apps.some((app) => can(a, app, 'call')));

  add(
    backend === 'firestore'
      ? { id: 'backend', title: 'Shared database', status: 'pass', detail: 'Everyone signs in with their own login and works on the same live data.' }
      : { id: 'backend', title: 'Shared database', status: 'fail', detail: 'This build keeps everything in one browser and has no real sign-in.', fix: 'Run the build that has the Firebase settings (VITE_FIREBASE_*). Never put real customers in the local demo build.' },
  );

  const byApp = countByOrigin(users);
  const perApp = Object.entries(byApp).filter(([, c]) => c.app > 0).map(([app, c]) => `${appName(app)} ${n(c.app)}`).join(' · ');
  add(
    real.length > 0
      ? { id: 'real-customers', title: 'Real customers loaded', status: 'pass', detail: `${plural(real.length, 'customer')} from the apps (${perApp}).` }
      : { id: 'real-customers', title: 'Real customers loaded', status: 'fail', detail: 'No real customers yet. Agents without demo status would have nobody to call.', fix: 'Import the export from RealBroks / IronDrobe.', to: '/customers-import' },
  );

  const badPhones = real.filter((u) => !normalizePhone(u.phone));
  if (real.length > 0) {
    add(
      badPhones.length === 0
        ? { id: 'phones', title: 'Customer phone numbers', status: 'pass', detail: 'Every real customer has a number that can be dialled.' }
        : { id: 'phones', title: 'Customer phone numbers', status: 'warn', detail: `${plural(badPhones.length, 'real customer')} ${badPhones.length === 1 ? 'has' : 'have'} a number that can’t be dialled (e.g. ${badPhones[0].name}).`, fix: 'Correct them in the source export and import again.', to: '/customers-import' },
    );
  }

  add(
    callers.length > 0
      ? { id: 'agents', title: 'Real agents ready to call', status: 'pass', detail: `${plural(callers.length, 'agent')} with queues and calling access.` }
      : { id: 'agents', title: 'Real agents ready to call', status: 'fail', detail: 'No active, non-demo agent has queues and permission to call.', fix: 'Add agents (not marked demo) with at least one queue.', to: '/people' },
  );

  const waiting = real.filter((u) => u.queue);
  const stranded = waiting.filter((u) => !callers.some((a) => a.queues.includes(u.queue!) && isReachable(a, u)));
  if (real.length > 0 && callers.length > 0) {
    add(
      stranded.length === 0
        ? { id: 'coverage', title: 'Every waiting customer can be reached', status: 'pass', detail: `${plural(waiting.length, 'customer')} in queues, each with an agent who speaks their language and covers their state.` }
        : { id: 'coverage', title: 'Every waiting customer can be reached', status: 'warn', detail: `${plural(stranded.length, 'customer')} in queues ${stranded.length === 1 ? 'has' : 'have'} no agent with the right language, state and queue.`, fix: 'Add the missing language or state to an agent.', to: '/allocation' },
    );
  }

  const leaked = realCustomersOwnedByDemo(users, agents);
  add(
    leaked.length === 0
      ? { id: 'demo-leak', title: 'Demo accounts hold no real customers', status: 'pass', detail: demoAgents.length ? `${plural(demoAgents.length, 'demo account')} — they only see demo customers and their calls ring the test line.` : 'No demo accounts.' }
      : { id: 'demo-leak', title: 'Demo accounts hold no real customers', status: 'fail', detail: `${plural(leaked.length, 'real customer')} ${leaked.length === 1 ? 'is' : 'are'} owned by a demo account.`, fix: 'Open the demo account in People, switch Demo off and on again, and save — their real customers are released.', to: '/people' },
  );

  // Phone line
  const tel = telephony;
  if (tel.provider === 'telecmi') {
    add(
      tel.testNumber
        ? { id: 'dialling', title: 'Dialling', status: 'warn', detail: `Test mode: every call rings ${tel.testNumber}, not the customer. Safe for trying things out.`, fix: 'To call real customers, remove VITE_TELEPHONY_TEST_NUMBER and set VITE_TELEPHONY_LIVE=true, then redeploy.' }
        : tel.live
          ? { id: 'dialling', title: 'Dialling', status: 'pass', detail: 'Live: real agents dial customers’ own numbers. Demo accounts still cannot.' }
          : { id: 'dialling', title: 'Dialling', status: 'fail', detail: 'Calling is locked — neither a test number nor live dialling is set.', fix: 'Set VITE_TELEPHONY_TEST_NUMBER to rehearse, or VITE_TELEPHONY_LIVE=true to go live, then redeploy.' },
    );
    const noLine = callers.filter((a) => a.clickToDial && !a.telecmiUserId);
    add(
      noLine.length === 0
        ? { id: 'lines', title: 'Phone lines', status: 'pass', detail: 'Every agent who calls from the browser has a phone line ID.' }
        : { id: 'lines', title: 'Phone lines', status: 'warn', detail: `${plural(noLine.length, 'agent')} without a phone line ID: ${noLine.slice(0, 4).map((a) => a.name).join(', ')}${noLine.length > 4 ? '…' : ''}. They will be asked to type it at every sign-in.`, fix: 'Add it under People › Phone line.', to: '/people' },
    );
  } else if (tel.provider === 'mock') {
    add({ id: 'dialling', title: 'Dialling', status: 'fail', detail: 'This is the demo line. Nothing is really dialled and recordings are made up.', fix: 'Set VITE_TELEPHONY_PROVIDER=telecmi and redeploy.' });
  } else {
    add({ id: 'dialling', title: 'Dialling', status: 'warn', detail: 'Browser calling is off. Agents dial from their own mobile and log the call by hand — no recordings or analysis.', fix: 'Set VITE_TELEPHONY_PROVIDER=telecmi to call from the browser.' });
  }

  // Server features
  if (server === null) {
    add({ id: 'server', title: 'Recordings and analysis', status: 'warn', detail: 'The TCC server did not answer, so recordings and call analysis will not work.', fix: 'Deploy the build that serves /api (npm start).' });
  } else if (tel.provider === 'telecmi') {
    add(
      server.recordings
        ? { id: 'recordings', title: 'Call recordings', status: 'pass', detail: 'The server can fetch recordings from the phone provider.' }
        : { id: 'recordings', title: 'Call recordings', status: 'warn', detail: 'Recordings cannot be played: the server has no phone-provider credentials.', fix: 'Set TELECMI_APP_ID and TELECMI_APP_SECRET on the server.' },
    );
    add(
      server.analysis
        ? { id: 'analysis', title: 'Call analysis', status: 'pass', detail: 'Recorded calls are transcribed and summarised automatically.' }
        : { id: 'analysis', title: 'Call analysis', status: 'warn', detail: 'No transcripts, summaries or sentiment: the server has no Gemini key.', fix: 'Set GEMINI_API_KEY on the server.' },
    );
  }

  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  return { checks, failed, warned, verdict: failed ? 'blocked' : warned ? 'caution' : 'ready' };
}
