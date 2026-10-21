import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { CallLogEntry, Lead } from '../../data/types';
import { outcomeTone } from '../../lib/callStatus';
import { sentimentBand } from '../../lib/analysis/model';
import { Badge, type Tone } from '../../ui/primitives';
import { outcomeLabel } from '../../brand';


export function SentimentBadge({ score }: { score: number | null | undefined }) {
  const band = sentimentBand(score);
  if (!band || score === null || score === undefined) return null;
  const tone: Tone = band === 'positive' ? 'ok' : band === 'negative' ? 'danger' : 'neutral';
  const word = band === 'positive' ? 'Positive' : band === 'negative' ? 'Negative' : 'Neutral';
  return <Badge tone={tone} title="Customer sentiment, 0–100">{word} · <span className="mono">{score}</span></Badge>;
}

export function OutcomeBadge({ call }: { call: CallLogEntry }) {
  return <Badge tone={outcomeTone(call)}>{call.outcome ? outcomeLabel(call.outcome) : call.status}</Badge>;
}

/** The agent's own positive / negative mark (not the sentiment the analysis measured). */
export function LeadBadge({ lead, prefix }: { lead: Lead | null | undefined; prefix?: string }) {
  if (!lead) return null;
  const Icon = lead === 'positive' ? ThumbsUp : ThumbsDown;
  const word = lead === 'positive' ? 'Positive' : 'Negative';
  return (
    <Badge tone={lead === 'positive' ? 'ok' : 'danger'} outline title="Marked by the agent after a call">
      <Icon size={12} aria-hidden style={{ marginRight: 4, verticalAlign: '-1px' }} />
      {prefix ? `${prefix} ${word.toLowerCase()}` : word}
    </Badge>
  );
}
