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
    ? new TeleCmiProvider({ scriptUrl: piopiyScriptUrl, region: (import.meta.env.VITE_TELECMI_REGION as string | undefined) || TELECMI_REGIONS.india, debug: import.meta.env.VITE_TELECMI_DEBUG === 'true' })
    : mode === 'mock'
      ? new MockProvider({ stats: { packetsSent: 50, packetsReceived: 50, bytesSent: 4000, bytesReceived: 4000, roundTripSec: 0.04, jitterSec: 0.005, codec: 'audio/opus', network: 'wifi' } })
      : null;

// Demo line only: ring the agent from the browser console — `tccSimulateIncoming('9876543210')`, then
// `tccSimulateHangup()` to have the caller give up (a missed call).
if (telephonyProvider instanceof MockProvider && typeof window !== 'undefined') {
  const mock = telephonyProvider;
  Object.assign(window, { tccSimulateIncoming: (from: string) => mock.simulateIncoming(from), tccSimulateHangup: () => mock.simulateRemoteHangup() });
}

// TCC's customer phone numbers are still generated sample data (see README), so a real provider would ring strangers.
// Until real customer data is wired in, live dialling needs an explicit choice:
//   VITE_TELEPHONY_TEST_NUMBER=<your number>  → every call is redirected to that number, whoever the customer is
//   VITE_TELEPHONY_LIVE=true                  → dial the customer's own number (only once the data is real)
export const TEST_NUMBER = (import.meta.env.VITE_TELEPHONY_TEST_NUMBER as string | undefined)?.trim() || null;
export const LIVE_DIAL_BLOCKED = mode === 'telecmi' && !TEST_NUMBER && import.meta.env.VITE_TELEPHONY_LIVE !== 'true';

/** A number a person typed in (dialled directly, or a customer added by hand) is real: it is always dialled as typed. */
export const isRealNumber = (user: CustomerUser): boolean => !!(user.adHoc || user.manual);

/** The number to actually dial for a customer (the test number, when one is set, for sample customers only). */
export function dialNumberFor(user: CustomerUser): string {
  return TEST_NUMBER && !isRealNumber(user) ? TEST_NUMBER : user.phone;
}

export const DEFAULT_COUNTRY_CODE = (import.meta.env.VITE_TELEPHONY_COUNTRY_CODE as string | undefined) || '91';

/** Tags attached to every call; TeleCMI echoes them back in its webhooks so a call can be tied to a customer and agent. */
export function callMeta(user: CustomerUser, agent: AgentAccount): Meta {
  return { app: user.app, customerId: user.id, agentId: agent.id, queue: user.queue ?? '', ...(TEST_NUMBER && !isRealNumber(user) ? { testRedirect: 'true' } : {}) };
}

/** What the softphone already knows about "did the call connect?". Provides an intelligent default status
 *  when a call is ended or cut so that agents and supervisors can log it without friction. */
export function suggestStatus(r: CallResult): CallStatus {
  switch (r.disposition) {
    case 'connected':
      return 'Answered — Followup';
    case 'cancelled':
    case 'no-answer':
    case 'busy':
    case 'rejected':
      return 'No Answer';
    case 'unreachable':
      return 'Not Reachable';
    default:
      return r.talkSeconds > 0 ? 'Answered — Followup' : 'No Answer';
  }
}

/** Demo/dev only (mock provider or no telephony): nothing here is a real call, recording, or transcript. */
export const SIMULATE_CALL_DATA = mode !== 'telecmi';

const DEMO_AUDIO = 'https://actions.google.com/sounds/v1/ambiences/office_murmur.ogg';

/**
 * Where the player streams a recording from. Real TeleCMI recordings go through TCC's own server
 * (server/api.ts), which holds the App Secret — TeleCMI's dashboard link now asks for a login.
 * Demo calls (mock line) have no real audio, so they play a stand-in clip. '' when there is no file.
 */
export function recordingUrlFor(filename: string | undefined): string {
  if (!filename) return '';
  if (/^https?:\/\//i.test(filename)) return filename;
  if (SIMULATE_CALL_DATA || filename.startsWith('rec_')) return DEMO_AUDIO;
  return `/api/recordings/${encodeURIComponent(filename)}`;
}

export function toCallTelephony(r: CallResult): CallTelephony {
  const answered = r.disposition === 'connected' || r.talkSeconds > 0;
  // Real calls only carry a recording once TeleCMI has announced one; the demo line fakes it so the player has something to show.
  const recordingFile = r.recordingFile ?? (SIMULATE_CALL_DATA && answered ? `rec_${r.providerCallId || r.id}.wav` : undefined);
  // The per-second loudness timeline rides on the last stats sample; store it once, beside the quality summary.
  const { timeline, ...quality } = r.stats ?? {};
  return {
    provider: r.provider,
    callId: r.providerCallId,
    durationSec: r.talkSeconds,
    ringSec: r.ringSeconds,
    disposition: r.disposition,
    ...(r.direction === 'inbound' ? { direction: 'inbound' as const } : {}),
    startedAt: r.startedAt,
    remote: r.remote,
    recordingFile,
    recordingUrl: recordingFile ? recordingUrlFor(recordingFile) || undefined : undefined,
    quality: r.stats ? quality : undefined,
    levels: timeline?.length ? timeline : undefined,
  };
}
