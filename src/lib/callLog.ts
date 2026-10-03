import { sampleAnalysis } from '../data/seed';
import type { CallAnalysis, CallLogEntry, CallStatus, CallTelephony, CustomerUser, Outcome } from '../data/types';
import { fmtDayTime } from './dates';
import { SIMULATE_CALL_DATA, recordingUrlFor } from './telephony';

export interface LogCallInput {
  status: CallStatus;
  outcome?: Outcome;
  comment: string;
  telephony?: CallTelephony;
  analysis?: CallAnalysis;
}

/**
 * One place that turns "the agent saved a call" into a log entry, for both stores.
 * Real (softphone) calls carry only what the provider actually reported — no invented
 * duration, recording, sentiment or transcript; their analysis arrives later from the
 * recording. Sample call data exists only in demo mode (mock line / no telephony), where it is
 * labelled as sample and nothing pretends to be a real call.
 */
export function buildCallLogEntry(now: number, agentName: string, user: CustomerUser, input: LogCallInput): CallLogEntry {
  const answered = input.status.startsWith('Answered') || (input.telephony?.durationSec ?? 0) > 0;
  const simulate = SIMULATE_CALL_DATA && answered;

  let telephony = input.telephony;
  if (telephony?.recordingFile && !telephony.recordingUrl) {
    telephony = { ...telephony, recordingUrl: recordingUrlFor(telephony.recordingFile) || undefined };
  }
  if (!telephony && simulate) {
    const file = `rec_${now}.wav`;
    telephony = { provider: 'demo', callId: `demo-${now}`, durationSec: 45, ringSec: 12, disposition: 'answered', recordingFile: file, recordingUrl: recordingUrlFor(file) };
  }

  const analysis = input.analysis ?? (simulate ? sampleAnalysis(now, user.name, user.app, input.outcome) : undefined);

  return {
    id: `cl-${now}-${Math.random().toString(36).slice(2, 7)}`,
    atTs: now,
    atLabel: fmtDayTime(now),
    agentName,
    status: input.status,
    outcome: input.outcome,
    comment: input.comment,
    telephony,
    analysis,
  };
}
