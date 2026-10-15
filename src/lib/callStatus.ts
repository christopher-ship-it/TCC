import type { CallLogEntry } from '../data/types';
import { NEGATIVE_OUTCOMES, POSITIVE_OUTCOMES } from '../data/types';
import type { Tone } from '../ui/primitives';
import { hasRealRecording } from './attachRecording';

export function outcomeTone(call: CallLogEntry): Tone {
  if (call.outcome && POSITIVE_OUTCOMES.includes(call.outcome)) return 'ok';
  if (call.outcome && NEGATIVE_OUTCOMES.includes(call.outcome)) return 'danger';
  if (call.outcome === 'Payment issue' || call.outcome === 'Technical issue') return 'warn';
  return 'neutral';
}

/** Where the call's analysis stands, in words. */
export function analysisState(call: CallLogEntry): { label: string; tone: Tone } | null {
  if (call.analysis) return call.analysis.source === 'sample' ? { label: 'Sample analysis', tone: 'neutral' } : call.analysis.source === 'whisper' ? { label: 'Transcript', tone: 'accent' } : { label: 'Analysed', tone: 'accent' };
  if (call.analysisError) return { label: 'Analysis failed', tone: 'danger' };
  if (hasRealRecording(call.telephony?.recordingFile)) return { label: 'Analysing…', tone: 'neutral' };
  if (call.telephony?.provider === 'telecmi' && call.telephony.durationSec > 0) return { label: 'Waiting for recording', tone: 'neutral' };
  return null;
}
