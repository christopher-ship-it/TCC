import { useMemo, useState } from 'react';
import SupervisorNav from '../../components/SupervisorNav';
import { useStore } from '../../store/StoreContext';
import AudioPlayer from '../../components/telephony/AudioPlayer';
import TranscriptDrawer from '../../components/agent/TranscriptDrawer';
import type { CallLogEntry, CustomerUser, Sentiment } from '../../data/types';
import { formatDuration } from '../../telephony';
import { APP_LOGOS } from '../../assets';
import { APPS } from '../../data/seed';

function sentimentStyle(s?: Sentiment) {
  switch (s) {
    case 'positive':
      return { bg: '#e6f4ea', color: '#137333', label: 'Positive' };
    case 'churn_risk':
      return { bg: '#fce8e6', color: '#c5221f', label: 'Churn risk' };
    default:
      return { bg: '#f1f3f4', color: '#5f6368', label: 'Neutral' };
  }
}

export default function CallAudits() {
  const { state } = useStore();
  const [selectedApp, setSelectedApp] = useState<string>('all');
  const [selectedSentiment, setSelectedSentiment] = useState<string>('all');
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCall, setActiveCall] = useState<{ user: CustomerUser; call: CallLogEntry } | null>(null);

  // Flatten all calls with their customer user
  const allCalls = useMemo(() => {
    const list: { user: CustomerUser; call: CallLogEntry }[] = [];
    for (const u of state.users) {
      for (const c of u.callHistory) {
        list.push({ user: u, call: c });
      }
    }
    return list.sort((a, b) => b.call.atTs - a.call.atTs);
  }, [state.users]);

  // Aggregate metrics
  const totalRecorded = allCalls.filter((c) => c.call.telephony?.recordingUrl || c.call.status.startsWith('Answered')).length;
  const analyzedCalls = allCalls.filter((c) => c.call.analytics);
  const positiveCount = analyzedCalls.filter((c) => c.call.analytics?.sentiment === 'positive').length;
  const churnRiskCount = analyzedCalls.filter((c) => c.call.analytics?.sentiment === 'churn_risk').length;
  const positivePct = analyzedCalls.length > 0 ? Math.round((positiveCount / analyzedCalls.length) * 100) : 0;
  const churnRiskPct = analyzedCalls.length > 0 ? Math.round((churnRiskCount / analyzedCalls.length) * 100) : 0;

  // Filtered list
  const filtered = useMemo(() => {
    return allCalls.filter(({ user, call }) => {
      if (selectedApp !== 'all' && user.app !== selectedApp) return false;
      if (selectedSentiment !== 'all' && call.analytics?.sentiment !== selectedSentiment) return false;
      if (selectedAgent !== 'all' && call.agentName !== selectedAgent) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = user.name.toLowerCase().includes(q);
        const matchPhone = user.phone.includes(q);
        const matchComment = call.comment?.toLowerCase().includes(q) ?? false;
        const matchSummary = call.analytics?.summary?.toLowerCase().includes(q) ?? false;
        if (!matchName && !matchPhone && !matchComment && !matchSummary) return false;
      }
      return true;
    });
  }, [allCalls, selectedApp, selectedSentiment, selectedAgent, searchQuery]);

  const agentsList = useMemo(() => {
    const names = new Set<string>();
    for (const { call } of allCalls) {
      if (call.agentName) names.add(call.agentName);
    }
    return Array.from(names);
  }, [allCalls]);

  return (
    <div>
      <SupervisorNav />

      {/* Top Stats Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '2px solid var(--color-divider)', background: 'var(--color-neutral-100)' }}>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRight: '1px solid var(--color-divider)' }}>
          <div className="eyebrow">Total calls logged</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, marginTop: 2 }}>{allCalls.length}</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>{totalRecorded} with audio playback</div>
        </div>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRight: '1px solid var(--color-divider)' }}>
          <div className="eyebrow">AI Post-Analytics</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, marginTop: 2, color: 'var(--color-accent-700)' }}>{analyzedCalls.length}</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>Conversations transcribed</div>
        </div>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRight: '1px solid var(--color-divider)' }}>
          <div className="eyebrow">Positive sentiment</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, marginTop: 2, color: '#137333' }}>{positivePct}%</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>{positiveCount} customer agreements</div>
        </div>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRight: '1px solid var(--color-divider)' }}>
          <div className="eyebrow">Churn &amp; objections</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, marginTop: 2, color: '#c5221f' }}>{churnRiskPct}%</div>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>{churnRiskCount} flagged for supervisor review</div>
        </div>
        <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <div className="eyebrow">TeleCMI Region</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 20, marginTop: 4 }}>India (sbcind)</div>
          <div style={{ fontSize: 11, color: '#137333', fontWeight: 600, marginTop: 2 }}>● Live softphone connected</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-divider)', background: 'var(--color-bg)', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="input"
          placeholder="Search customer, phone, comment or transcript..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ minWidth: 260, fontSize: 12, padding: '4px 10px' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: 'var(--color-neutral-700)' }}>App:</span>
          <select
            className="input"
            value={selectedApp}
            onChange={(e) => setSelectedApp(e.target.value)}
            style={{ fontSize: 12, padding: '3px 8px' }}
          >
            <option value="all">All Apps</option>
            {APPS.filter((a) => a.live).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: 'var(--color-neutral-700)' }}>Sentiment:</span>
          <select
            className="input"
            value={selectedSentiment}
            onChange={(e) => setSelectedSentiment(e.target.value)}
            style={{ fontSize: 12, padding: '3px 8px' }}
          >
            <option value="all">All Sentiments</option>
            <option value="positive">Positive (+)</option>
            <option value="neutral">Neutral (=)</option>
            <option value="churn_risk">Churn Risk (!)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: 'var(--color-neutral-700)' }}>Agent:</span>
          <select
            className="input"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            style={{ fontSize: 12, padding: '3px 8px' }}
          >
            <option value="all">All Agents</option>
            {agentsList.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-700)' }}>
          Showing <strong>{filtered.length}</strong> of {allCalls.length} calls
        </div>
      </div>

      {/* Call Recordings & Post Analytics Table */}
      <div style={{ padding: 'var(--space-4)' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-neutral-700)' }}>
            <h3>No matching call recordings</h3>
            <p style={{ marginTop: 4 }}>Try clearing the search query or adjusting the filters.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {filtered.map(({ user, call }) => {
              const sBadge = sentimentStyle(call.analytics?.sentiment);
              const duration = call.telephony?.durationSec ?? 0;
              const hasAudio = Boolean(call.telephony?.recordingUrl || (duration > 0 && call.status.startsWith('Answered')));
              const audioUrl = call.telephony?.recordingUrl || (hasAudio ? 'https://actions.google.com/sounds/v1/ambiences/office_murmur.ogg' : '');

              return (
                <div
                  key={call.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '220px 140px 180px 1fr 280px',
                    alignItems: 'center',
                    gap: 'var(--space-4)',
                    padding: 'var(--space-3) var(--space-4)',
                    background: 'var(--color-neutral-100)',
                    border: '1px solid var(--color-divider)',
                    borderRadius: 4,
                  }}
                >
                  {/* Customer Info */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <img src={APP_LOGOS[user.app]} alt={user.app} style={{ height: 14, width: 'auto', objectFit: 'contain' }} />
                      <strong style={{ fontSize: 13 }}>{user.name}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>
                      {user.phone} · {user.city}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 1 }}>
                      {call.atLabel}
                    </div>
                  </div>

                  {/* Agent & Duration */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{call.agentName}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>
                      {duration > 0 ? `${formatDuration(duration)} duration` : 'Did not connect'}
                    </div>
                  </div>

                  {/* Status & Outcome */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{call.status}</div>
                    {call.outcome && (
                      <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>
                        {call.outcome}
                      </div>
                    )}
                    {call.analytics && (
                      <div style={{ marginTop: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: sBadge.bg, color: sBadge.color }}>
                          {sBadge.label}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Comment & AI Summary */}
                  <div>
                    {call.comment && (
                      <div style={{ fontSize: 11, color: 'var(--color-text)', fontStyle: 'italic', marginBottom: 4 }}>
                        "{call.comment}"
                      </div>
                    )}
                    {call.analytics?.summary && (
                      <div style={{ fontSize: 11, color: 'var(--color-neutral-800)', lineHeight: 1.4 }}>
                        <strong style={{ color: 'var(--color-accent-700)' }}>AI Summary: </strong>
                        {call.analytics.summary}
                      </div>
                    )}
                  </div>

                  {/* Audio Player & Transcript Drawer Action */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
                    {hasAudio && (
                      <AudioPlayer src={audioUrl} durationSec={duration} label="Call Audio" />
                    )}

                    {call.analytics ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setActiveCall({ user, call })}
                        style={{
                          fontSize: 11,
                          padding: '4px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          fontWeight: 600,
                        }}
                      >
                        <span>View AI Transcript &amp; Post-Analytics</span>
                        <span>▸</span>
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', textAlign: 'center' }}>
                        No transcript (unanswered)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Slide-out AI Transcript Drawer */}
      {activeCall && (
        <TranscriptDrawer
          user={activeCall.user}
          call={activeCall.call}
          onClose={() => setActiveCall(null)}
        />
      )}
    </div>
  );
}
