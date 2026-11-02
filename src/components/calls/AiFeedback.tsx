// "Was the AI right?" The agent's verdict on the AI's reading of a call: good, partly right or wrong, with the outcome
// it should have been and a note when it was not right. TCC learns from these (src/lib/aiFeedback.ts).

import { Sparkles } from 'lucide-react';
import { ANALYSIS_OUTCOMES } from '../../lib/analysis/model';
import { VERDICTS, type FeedbackDraft, type Verdict } from '../../lib/aiFeedback';
import { outcomeLabel } from '../../brand';
import { Button, Select, Textarea } from '../../ui/primitives';

const LABEL: Record<Verdict, string> = { good: 'Right', partly: 'Partly right', wrong: 'Wrong' };

export function AiFeedbackFields({ value, onChange, aiOutcome, compact }: { value: FeedbackDraft; onChange: (d: FeedbackDraft) => void; aiOutcome?: string; compact?: boolean }) {
  const set = (patch: Partial<FeedbackDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }} role="group" aria-label="Was the AI’s reading right?">
        <span className="row" style={{ gap: 6, fontSize: 13.5, fontWeight: 500 }}><Sparkles size={14} aria-hidden />Was the AI’s reading right?</span>
        {VERDICTS.map((v) => (
          <Button key={v} size="sm" variant={value.verdict === v ? 'primary' : 'secondary'} aria-pressed={value.verdict === v} onClick={() => set({ verdict: value.verdict === v ? '' : v })}>{LABEL[v]}</Button>
        ))}
      </div>
      {(value.verdict === 'partly' || value.verdict === 'wrong') && (
        <div className="stack" style={{ gap: 8 }}>
          {!compact && (
            <label className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 13 }}>It should have said</span>
              <Select aria-label="What it should have said" value={value.outcome} onChange={(e) => set({ outcome: e.target.value })} style={{ width: 'auto' }}>
                <option value="">{aiOutcome ? `Same: ${outcomeLabel(aiOutcome)}` : 'Not sure'}</option>
                {ANALYSIS_OUTCOMES.filter((o) => o !== aiOutcome).map((o) => <option key={o} value={o}>{outcomeLabel(o)}</option>)}
              </Select>
            </label>
          )}
          <label className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 13 }}>The customer was</span>
            <Select aria-label="How receptive the customer was" value={value.sentiment} onChange={(e) => set({ sentiment: e.target.value as FeedbackDraft['sentiment'] })} style={{ width: 'auto' }}>
              <option value="">Not sure</option>
              <option value="positive">Positive (interested)</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative (not interested)</option>
            </Select>
          </label>
          <Textarea aria-label="What it got wrong" rows={2} placeholder="What did it get wrong? (optional, this teaches it)" value={value.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
      )}
    </div>
  );
}
