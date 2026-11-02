// Whether, and to which number, a call may actually go out. Decided per call from who is calling and who they are
// calling — not from one deployment-wide switch — so a demo account can never ring a real customer, and a made-up
// customer's number can never be dialled for real.
import type { AgentAccount, CustomerUser } from '../data/types.ts';
import { isDemoAgent, originOf } from './world.ts';

export interface DialEnv {
  /** 'telecmi' places real calls; 'mock' is a fake line; null means no browser calling (a tel: link on the agent's own phone). */
  provider: 'telecmi' | 'mock' | null;
  /** When set, calls are redirected to this number instead of the customer's. */
  testNumber: string | null;
  /** Production switch: dial customers' own numbers. */
  live: boolean;
}

export type DialPlan =
  | { mode: 'live'; number: string }
  | { mode: 'redirect'; number: string; reason: string }
  | { mode: 'blocked'; reason: string };

export function planDial(customer: Pick<CustomerUser, 'id' | 'phone' | 'adHoc' | 'origin'>, agent: Pick<AgentAccount, 'demo'>, env: DialEnv): DialPlan {
  const demo = isDemoAgent(agent) || originOf(customer) === 'sample';

  if (env.provider === 'mock') return { mode: 'live', number: customer.phone }; // a fake line: nothing is dialled

  if (demo) {
    if (env.provider === null) return { mode: 'blocked', reason: 'Demo accounts cannot place real calls. Use a demo line or ask an admin.' };
    if (env.testNumber) return { mode: 'redirect', number: env.testNumber, reason: `Demo account — this call rings the test line ${env.testNumber}, not the customer.` };
    return { mode: 'blocked', reason: 'Demo accounts cannot place real calls. Ask an admin to set a test number.' };
  }

  if (env.provider === null) return { mode: 'live', number: customer.phone };
  if (env.testNumber && !customer.adHoc) return { mode: 'redirect', number: env.testNumber, reason: `Test mode — this call rings ${env.testNumber}, not the customer.` };
  if (customer.adHoc) return { mode: 'live', number: customer.phone }; // typed in on purpose
  if (env.live) return { mode: 'live', number: customer.phone };
  return { mode: 'blocked', reason: 'Live dialling is switched off on this deployment (VITE_TELEPHONY_LIVE).' };
}
