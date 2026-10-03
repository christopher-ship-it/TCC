import type { CallLogEntry } from '../../data/types';
import { outcomeTone } from '../../lib/callStatus';
import { sentimentBand } from '../../lib/analysis/model';
import { Badge, type Tone } from '../../ui/primitives';


export function SentimentBadge({ score }: { score: number | null | undefined }) {
  const band = sentimentBand(score);
  if (!band || score === null || score === undefined) return null;
  const tone: Tone = band === 'positive' ? 'ok' : band === 'negative' ? 'danger' : 'neutral';
  const word = band === 'positive' ? 'Positive' : band === 'negative' ? 'Negative' : 'Neutral';
  return <Badge tone={tone} title="Customer sentiment, 0–100">{word} · <span className="mono">{score}</span></Badge>;
}

export function OutcomeBadge({ call }: { call: CallLogEntry }) {
  return <Badge tone={outcomeTone(call)}>{call.outcome ?? call.status}</Badge>;
}
