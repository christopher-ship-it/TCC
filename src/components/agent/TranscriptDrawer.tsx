import { useEffect } from 'react';
import type { CallLogEntry, CustomerUser, Sentiment } from '../../data/types';
import AudioPlayer from '../telephony/AudioPlayer';

interface TranscriptDrawerProps {
  user: CustomerUser;
  call: CallLogEntry;
  onClose: () => void;
}

function sentimentStyle(sentiment: Sentiment): { bg: string; color: string; border: string; label: string } {
  switch (sentiment) {
    case 'positive':
      return { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0', label: 'Positive' };
    case 'churn_risk':
      return { bg: '#fef2f2', color: '#991b1b', border: '#fecaca', label: 'Churn Risk' };
    case 'negative':
      return { bg: '#fff7ed', color: '#9a3412', border: '#fed7aa', label: 'Negative' };
    case 'neutral':
    default:
      return { bg: '#f3f4f6', color: '#374151', border: '#e5e7eb', label: 'Neutral' };
  }
}

function fmtOffset(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function TranscriptDrawer({ user, call, onClose }: TranscriptDrawerProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const analytics = call.analytics;
  const sStyle = analytics ? sentimentStyle(analytics.sentiment) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 540,
          maxWidth: '100%',
          height: '100%',
          background: 'var(--color-bg, #fff)',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideLeft 0.2s ease-out',
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: 'var(--space-4, 16px)',
            borderBottom: '2px solid var(--color-divider, #e5e7eb)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            background: 'var(--color-neutral-100, #f8f9fa)',
          }}
        >
          <div>
            <div className="eyebrow" style={{ color: 'var(--color-accent-700, #0369a1)', marginBottom: 2 }}>
              Post-Call AI Intelligence
            </div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{user.name}</h3>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-600, #4b5563)', marginTop: 2 }}>
              {call.atLabel} · Logged by {call.agentName} · {call.status}
              {call.outcome ? ` · ${call.outcome}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
          >
            ✕ Close
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4, 16px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Recording Player if present */}
          {call.telephony?.recordingUrl && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Audio Recording</div>
              <AudioPlayer
                src={call.telephony.recordingUrl}
                durationSec={call.telephony.durationSec}
                label={`${user.name} (${fmtOffset(call.telephony.durationSec)})`}
              />
            </div>
          )}

          {/* AI Analytics Summary & Sentiment */}
          {analytics ? (
            <>
              <div
                style={{
                  padding: 12,
                  borderRadius: 6,
                  background: sStyle?.bg,
                  border: `1px solid ${sStyle?.border}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: sStyle?.color,
                        color: '#fff',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {sStyle?.label}
                    </span>
                    <span style={{ fontSize: 12, color: sStyle?.color, fontWeight: 600 }}>
                      Sentiment score: {analytics.sentimentScore > 0 ? `+${analytics.sentimentScore.toFixed(2)}` : analytics.sentimentScore.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-neutral-700, #4b5563)', marginBottom: 2 }}>
                    AI Summary
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-text, #111)' }}>
                    {analytics.summary}
                  </div>
                </div>

                {analytics.keyTopics && analytics.keyTopics.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                    {analytics.keyTopics.map((topic) => (
                      <span
                        key={topic}
                        style={{
                          fontSize: 11,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: 'rgba(0,0,0,0.06)',
                          color: 'var(--color-text, #111)',
                        }}
                      >
                        #{topic}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Items */}
              {analytics.actionItems && analytics.actionItems.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Extracted Action Items</div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      background: 'var(--color-neutral-100, #f8f9fa)',
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid var(--color-divider, #e5e7eb)',
                    }}
                  >
                    {analytics.actionItems.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
                        <span style={{ color: 'var(--color-accent-700, #0369a1)', fontWeight: 700 }}>▸</span>
                        <span style={{ color: 'var(--color-text, #111)' }}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full Verbatim Transcript */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div className="eyebrow">Conversation Transcript</div>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-600, #6b7280)' }}>
                    {analytics.transcript.length} turns
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {analytics.transcript.map((msg, i) => {
                    const isAgent = msg.speaker === 'agent';
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isAgent ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'var(--color-neutral-600, #6b7280)',
                            marginBottom: 2,
                            display: 'flex',
                            gap: 6,
                          }}
                        >
                          <span>{isAgent ? `Agent (${call.agentName})` : `Customer (${user.name})`}</span>
                          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fmtOffset(msg.offsetSec)}</span>
                        </div>
                        <div
                          style={{
                            maxWidth: '85%',
                            padding: '8px 12px',
                            borderRadius: 8,
                            fontSize: 12,
                            lineHeight: 1.5,
                            background: isAgent ? 'var(--color-accent, #0f172a)' : 'var(--color-neutral-100, #f1f5f9)',
                            color: isAgent ? '#fff' : 'var(--color-text, #111)',
                            border: isAgent ? 'none' : '1px solid var(--color-divider, #e2e8f0)',
                          }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--color-neutral-600, #6b7280)',
                background: 'var(--color-neutral-100, #f8f9fa)',
                borderRadius: 6,
                border: '1px dashed var(--color-divider, #d1d5db)',
                fontSize: 13,
              }}
            >
              No AI transcript available for this call attempt.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
