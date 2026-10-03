import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Lock, MessageSquareWarning, RotateCcw, Sparkles } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { APPS } from '../data/seed';
import { telephonyQualitySummary } from '../data/types';
import { can } from '../lib/access';
import { hasRealRecording } from '../lib/attachRecording';
import { clock, sentimentBand } from '../lib/analysis/model';
import { speakingBlocks, talkShare } from '../lib/analysis/speakers';
import { analyzeCall } from '../lib/transcription';
import { recordingUrlFor } from '../lib/telephony';
import { formatDuration } from '../telephony';
import { OutcomeBadge, SentimentBadge } from '../components/calls/badges';
import { ConversationTimeline, Legend, TalkSplit, type SpeakingSpan } from '../ui/charts';
import { RecordingPlayer } from '../ui/RecordingPlayer';
import { Badge, Button, Callout, Card, Empty, Meter, PageHead } from '../ui/primitives';
import './customer.css';

export default function CallDetail() {
  const { id, entryId } = useParams<{ id: string; entryId: string }>();
  const { state, dispatch, currentAgent } = useStore();
  const agent = currentAgent!;
  const user = state.users.find((u) => u.id === id);
  const call = user?.callHistory.find((c) => c.id === entryId);
  const [playhead, setPlayhead] = useState(0);
  const seekRef = useRef<((s: number) => void) | null>(null);
  const registerSeek = useCallback((fn: (s: number) => void) => {
    seekRef.current = fn;
  }, []);
  const [working, setWorking] = useState(false);

  const a = call?.analysis;
  const spans = useMemo<SpeakingSpan[]>(() => {
    if (!call) return [];
    const blocks = speakingBlocks(call.telephony?.levels);
    if (blocks.length) return blocks;
    const lines = a?.transcript ?? [];
    return lines
      .map((l, i) => ({ l, to: lines[i + 1]?.atSec ?? l.atSec + 4 }))
      .filter(({ l }) => l.speaker !== 'unknown')
      .map(({ l, to }) => ({ speaker: l.speaker as 'agent' | 'customer', from: l.atSec, to: Math.max(to - 0.5, l.atSec + 1), text: l.text }));
  }, [call, a]);

  if (!user || !call) return <div className="page"><Empty title="Call not found" action={<Link to="/calls" className="btn">All calls</Link>} /></div>;
  if (agent.role !== 'admin' && !agent.apps.includes(user.app)) return <div className="page"><Empty icon={<Lock size={22} />} title="Not in your apps" /></div>;

  const hear = can(agent, user.app, 'recordings');
  const t = call.telephony;
  const file = t?.recordingFile;
  const real = hasRealRecording(file);
  const src = file ? recordingUrlFor(file) : '';
  const duration = Math.max(t?.durationSec ?? 0, ...(a?.transcript.map((l) => l.atSec + 3) ?? [0]), ...spans.map((s) => s.to));
  const share = a ? talkShare(t?.levels, a.transcript) : null;
  const band = sentimentBand(a?.sentiment);
  const quality = telephonyQualitySummary(t?.quality);

  async function runAnalysis() {
    if (!user || !call) return;
    setWorking(true);
    try {
      dispatch({ type: 'SET_ANALYSIS', userId: user.id, entryId: call.id, analysis: await analyzeCall(call, user) });
    } catch (e) {
      dispatch({ type: 'SET_ANALYSIS', userId: user.id, entryId: call.id, error: e instanceof Error ? e.message : 'Analysis failed' });
    } finally {
      setWorking(false);
    }
  }

  const activeLine = a ? a.transcript.reduce((best, l, i) => (l.atSec <= playhead + 0.25 ? i : best), -1) : -1;

  return (
    <div className="page">
      <PageHead
        eyebrow={<Link to={`/customers/${user.id}`}>← {user.name}</Link>}
        title={<span className="row" style={{ gap: 10 }}>Call on {call.atLabel} <OutcomeBadge call={call} /></span>}
        desc={`${user.business} · ${APPS.find((x) => x.id === user.app)?.name} · ${call.agentName}${t?.durationSec ? ` · ${formatDuration(t.durationSec)} talk time` : ' · did not connect'}`}
      />

      {!hear ? (
        <Card><Empty icon={<Lock size={22} />} title="Recordings are not part of your access">Ask an admin for “Hear recordings” in {APPS.find((x) => x.id === user.app)?.name}.</Empty></Card>
      ) : (
        <div className="call-layout">
          <div className="stack" style={{ gap: 16 }}>
            <Card title="Recording" sub={a && a.transcript.length ? 'Click a transcript line or a stretch of the timeline to jump there' : undefined}>
              {src ? (
                <RecordingPlayer src={src} durationHint={t?.durationSec} onTime={setPlayhead} registerSeek={registerSeek} sample={!real} />
              ) : t?.durationSec ? (
                <Callout icon={<Loader2 size={16} className="spin" />}>Waiting for TeleCMI to finish the recording — usually under a minute after the call ends.</Callout>
              ) : (
                <span className="muted">The call didn’t connect, so there is nothing to record.</span>
              )}
            </Card>

            {spans.length > 0 && (
              <Card title="Who spoke when" sub={t?.levels?.length ? 'Measured on the line during the call' : 'Estimated from the transcript'} actions={<Legend items={[{ label: 'Agent', color: 'var(--series-1)' }, { label: 'Customer', color: 'var(--series-2)' }]} />}>
                <ConversationTimeline spans={spans} duration={duration} playhead={playhead} onSeek={(s) => seekRef.current?.(s)} measured={!!t?.levels?.length} />
              </Card>
            )}

            <Card title="Transcript" sub={a ? `${a.transcript.length} lines${a.languages.length ? ` · ${a.languages.join(', ')}` : ''}${a.source === 'sample' ? ' · sample data' : a.source === 'whisper' ? ' · speakers not separated' : ''}` : undefined}>
              {!a ? (
                <span className="muted">{real ? 'Not analysed yet.' : 'No transcript for this call.'}</span>
              ) : a.transcript.length === 0 ? (
                <span className="muted">No speech was detected in this recording.</span>
              ) : (
                <div className="transcript">
                  {a.transcript.map((l, i) => (
                    <button key={i} type="button" className={`line${i === activeLine ? ' is-active' : ''}`} onClick={() => seekRef.current?.(l.atSec)}>
                      <span className="line__at">{clock(l.atSec)}</span>
                      <span>
                        <span className={`line__who line__who--${l.speaker}`}>{l.speaker === 'agent' ? call.agentName : l.speaker === 'customer' ? user.name : 'Speaker'}</span>
                        {l.text}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="stack" style={{ gap: 16 }}>
            {(!a || call.analysisError || a.source === 'whisper') && real && (
              <Card title="Analysis">
                <div className="stack" style={{ gap: 10 }}>
                  {call.analysisError ? (
                    <Callout tone="danger" icon={<AlertTriangle size={16} />}>{call.analysisError}</Callout>
                  ) : !a ? (
                    <span className="muted">Recorded calls are analysed automatically. You can also run it now.</span>
                  ) : (
                    <span className="muted">Only a transcript is available. Add GEMINI_API_KEY on the server for summary and sentiment.</span>
                  )}
                  <Button variant="primary" icon={working ? <Loader2 size={15} className="spin" /> : call.analysisError ? <RotateCcw size={15} /> : <Sparkles size={15} />} disabled={working} onClick={() => void runAnalysis()}>
                    {working ? 'Analysing…' : call.analysisError ? 'Try again' : 'Analyse this call'}
                  </Button>
                </div>
              </Card>
            )}

            {a && a.sentiment !== null && (
              <Card title="Customer sentiment" actions={a.source === 'sample' && <Badge>Sample data</Badge>}>
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
                    <span className="score-big" style={{ color: band === 'positive' ? 'var(--ok)' : band === 'negative' ? 'var(--danger)' : 'var(--ink)' }}>{a.sentiment}</span>
                    <span className="muted">out of 100</span>
                    <SentimentBadge score={a.sentiment} />
                  </div>
                  <Meter value={a.sentiment} color={band === 'positive' ? 'var(--ok)' : band === 'negative' ? 'var(--danger)' : 'var(--warn)'} />
                  {a.outcome && <span className="muted" style={{ fontSize: 13 }}>Read of the call: <b style={{ color: 'var(--ink)' }}>{a.outcome}</b>{call.outcome && a.outcome !== call.outcome ? ` — the agent logged “${call.outcome}”` : ''}</span>}
                </div>
              </Card>
            )}

            {share && share.agent + share.customer > 0 && (
              <Card title="Talk share" sub={share.measured ? 'Measured on the line' : 'Estimated from transcript timing'}>
                <TalkSplit agent={share.agent} customer={share.customer} />
              </Card>
            )}

            {a?.summary && (
              <Card title="Summary">
                <p style={{ lineHeight: 1.55 }}>{a.summary}</p>
              </Card>
            )}

            {a && (a.keyPoints.length > 0 || a.objections.length > 0) && (
              <Card title="What came up">
                <div className="stack" style={{ gap: 14 }}>
                  {a.keyPoints.length > 0 && (
                    <div className="stack" style={{ gap: 6 }}>
                      <span className="section-label row" style={{ gap: 6 }}><CheckCircle2 size={15} color="var(--ok)" />Key points</span>
                      <ul className="bullets">{a.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                  )}
                  {a.objections.length > 0 && (
                    <div className="stack" style={{ gap: 6 }}>
                      <span className="section-label row" style={{ gap: 6 }}><MessageSquareWarning size={15} color="var(--warn)" />Objections</span>
                      <ul className="bullets">{a.objections.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {a && (a.recommendation || a.actionItems.length > 0) && (
              <Card title="Next step">
                <div className="stack" style={{ gap: 8 }}>
                  {a.recommendation && <b style={{ fontWeight: 600 }}>{a.recommendation}</b>}
                  {a.actionItems.filter((x) => x !== a.recommendation).length > 0 && <ul className="bullets">{a.actionItems.filter((x) => x !== a.recommendation).map((p, i) => <li key={i}>{p}</li>)}</ul>}
                </div>
              </Card>
            )}

            <Card title="Logged by the agent">
              <div className="kv"><span>Status</span><span>{call.status}</span></div>
              {call.outcome && <div className="kv"><span>Outcome</span><span>{call.outcome}</span></div>}
              {t?.ringSec ? <div className="kv"><span>Rang for</span><span className="mono">{t.ringSec}s</span></div> : null}
              {quality && <div className="kv"><span>Line</span><span>{quality}</span></div>}
              {call.comment && <p style={{ marginTop: 10, color: 'var(--ink-2)' }}>“{call.comment}”</p>}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
