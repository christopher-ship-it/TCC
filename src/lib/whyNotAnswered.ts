import type { CallLogEntry } from '../data/types.ts';

/** For a call nobody talked on: what the line reported and what it means, in plain words. */
export function whyNotAnswered(call: CallLogEntry): { result: string; why: string; next: string } {
  const t = call.telephony;
  const inbound = t?.direction === 'inbound';
  const rang = t?.ringSec ? ` for ${t.ringSec}s` : '';
  const ring = rang ? ` after ringing${rang}` : '';
  const next = inbound ? 'They called us, so a call back is the way to reach them.' : 'They stay in the queue for another try.';
  switch (t?.disposition) {
    case 'rejected':
      return { result: 'Declined', why: inbound ? `${call.agentName} declined the call${ring}.` : 'The customer declined the call.', next };
    case 'cancelled':
      return { result: 'Cancelled', why: `${call.agentName} hung up before it was answered${ring}.`, next };
    case 'busy':
      return { result: 'Line busy', why: 'The customer’s line was busy.', next };
    case 'unreachable':
      return { result: 'Not reachable', why: 'The number is switched off, out of coverage, or not a valid number.', next };
    case 'failed':
      return { result: 'Call failed', why: 'A technical problem stopped the call (microphone, network, or the phone line). It is not the customer’s doing.', next };
    case 'no-answer':
      return { result: 'No answer', why: inbound ? `It rang${rang} on ${call.agentName}’s line, was not picked up, and the caller gave up.` : `It rang${rang} and the customer did not pick up.`, next };
    default:
      return call.status === 'Not Reachable'
        ? { result: 'Not reachable', why: 'The agent logged this call as not reachable.', next }
        : { result: 'No answer', why: inbound ? `${call.agentName} did not take the call${ring}.` : `The customer did not pick up${ring}.`, next };
  }
}
