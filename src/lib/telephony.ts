// TCC's wiring of the reusable telephony module (src/telephony): which provider is switched on,
// and how a finished call maps onto TCC's own vocabulary.
import piopiyScriptUrl from 'piopiyjs/dist/piopiy.min.js?url';
import type { AgentAccount, CallStatus, CallTelephony, CustomerUser } from '../data/types';
import { MockProvider, TELECMI_REGIONS, TeleCmiProvider, type CallResult, type Meta, type TelephonyProviderContract } from '../telephony';

// Off by default, so a deployment with no telephony config keeps the plain tel: dial link.
//   VITE_TELEPHONY_PROVIDER=telecmi  → real calls (agents sign in with their TeleCMI user)
//   VITE_TELEPHONY_PROVIDER=mock     → fake line for demos/dev; never dials anyone
const mode = import.meta.env.VITE_TELEPHONY_PROVIDER as string | undefined;

export const telephonyProvider: TelephonyProviderContract | null =
  mode === 'telecmi'
    ? new TeleCmiProvider({ scriptUrl: piopiyScriptUrl, region: (import.meta.env.VITE_TELECMI_REGION as string | undefined) || TELECMI_REGIONS.india })
    : mode === 'mock'
      ? new MockProvider()
      : null;

export const DEFAULT_COUNTRY_CODE = (import.meta.env.VITE_TELEPHONY_COUNTRY_CODE as string | undefined) || '91';

/** Tags attached to every call; TeleCMI echoes them back in its webhooks so a call can be tied to a customer and agent. */
export function callMeta(user: CustomerUser, agent: AgentAccount): Meta {
  return { app: user.app, customerId: user.id, agentId: agent.id, queue: user.queue ?? '' };
}

/** What the softphone already knows about "did the call connect?". Answered calls are left for the agent to
 *  classify (DG / DNG / follow-up needs a human), so this only suggests the unanswered cases. */
export function suggestStatus(r: CallResult): CallStatus | null {
  switch (r.disposition) {
    case 'no-answer':
    case 'busy':
    case 'rejected':
      return 'No Answer';
    case 'unreachable':
      return 'Not Reachable';
    default:
      return null;
  }
}

export function toCallTelephony(r: CallResult): CallTelephony {
  return { provider: r.provider, callId: r.providerCallId, durationSec: r.talkSeconds, ringSec: r.ringSeconds, disposition: r.disposition };
}
