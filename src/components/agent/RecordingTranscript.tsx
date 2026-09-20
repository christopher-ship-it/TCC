import { useEffect, useState } from 'react';
import type { CallLogEntry, CallTranscript, Language } from '../../data/types';
import { languageHint, transcribeRecording } from '../../lib/transcription';

// Entries already tried this session, so re-renders never re-trigger an automatic run (a failure shows a Retry button instead).
const attempted = new Set<string>();

const box = { fontSize: 11, lineHeight: 1.45, color: 'var(--color-neutral-800)' } as const;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Real transcript of one call recording, produced by the local Whisper service. Starts by itself once a recording exists. */
export default function RecordingTranscript({ entry, language, onTranscript }: { entry: CallLogEntry; language?: Language; onTranscript: (t: CallTranscript) => void }) {
  const file = entry.telephony?.recordingFile;
  const [state, setState] = useState<{ status: 'idle' | 'working' | 'error'; message?: string }>({ status: 'idle' });

  async function run() {
    if (!file) return;
    setState({ status: 'working' });
    try {
      onTranscript(await transcribeRecording(file, languageHint(language)));
      setState({ status: 'idle' });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Transcription failed' });
    }
  }

  useEffect(() => {
    if (!file || entry.transcript || attempted.has(entry.id)) return;
    attempted.add(entry.id);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, entry.id, entry.transcript]);

  if (entry.transcript) {
    const t = entry.transcript;
    return (
      <div style={{ ...box, display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>Transcript</strong>
          {t.language && <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--color-neutral-700)' }}>{t.language} · auto-detected</span>}
        </div>
        <div style={{ background: 'var(--color-bg)', padding: '4px 6px' }}>{t.text || <em>No speech detected.</em>}</div>
        {t.segments.length > 1 && (
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--color-neutral-700)' }}>{t.segments.length} segments</summary>
            {t.segments.map((s, i) => (
              <div key={i}><span style={{ fontFamily: 'ui-monospace,Menlo,monospace', color: 'var(--color-neutral-700)' }}>{mmss(s.start)}</span> {s.text}</div>
            ))}
          </details>
        )}
        <div style={{ color: 'var(--color-neutral-700)' }}>Machine transcript — may contain errors. The recording is mono, so the two speakers are not labelled.</div>
      </div>
    );
  }
  if (state.status === 'working') return <div style={box}>Transcribing… (the first run loads the model and can take about half a minute)</div>;
  if (state.status === 'error') {
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#a3271b' }}>{state.message}</span>
        <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => void run()}>Retry</button>
      </div>
    );
  }
  return null;
}
