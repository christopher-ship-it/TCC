import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { Button } from './primitives';

const SPEEDS = [1, 1.25, 1.5, 2];

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/**
 * Plays a call recording through a real <audio> element. `onTime` reports the playhead and `registerSeek`
 * hands the parent a seek function — that is how a transcript line or a timeline span jumps the audio.
 * A failed load says so; it never substitutes other audio.
 */
export function RecordingPlayer({ src, durationHint, onTime, registerSeek, sample }: { src: string; durationHint?: number; onTime?: (s: number) => void; registerSeek?: (fn: (s: number) => void) => void; sample?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationHint ?? 0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const seek = useCallback((s: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(s, Number.isFinite(el.duration) ? el.duration : s));
    setCurrent(el.currentTime);
    if (el.paused) void el.play().catch(() => undefined);
  }, []);

  useEffect(() => registerSeek?.(seek), [registerSeek, seek]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    setError(null);
    setPlaying(false);
    setCurrent(0);
  }, [src]);

  function retry() {
    const el = audio.current;
    setError(null);
    if (!el) return;
    el.load(); // asks the server again
    void el.play().catch(() => undefined);
  }

  async function toggle() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) return el.pause();
    setLoading(true);
    try {
      await el.play();
    } catch {
      // the error event explains why
    } finally {
      setLoading(false);
    }
  }

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface-2)' }}>
        <Button variant="primary" size="sm" iconOnly aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={() => void toggle()} disabled={!!error} icon={playing ? <Pause size={15} /> : <Play size={15} />} />
        <Button variant="ghost" size="sm" iconOnly aria-label="Back 10 seconds" onClick={() => seek(current - 10)} icon={<RotateCcw size={14} />} />
        <span className="mono" style={{ fontSize: 12.5, minWidth: 34 }}>{clock(current)}</span>
        <input
          type="range"
          aria-label="Position in recording"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ flex: 1, minWidth: 60, accentColor: 'var(--accent)', background: `linear-gradient(to right, var(--accent) ${pct}%, transparent ${pct}%)` }}
        />
        <span className="mono muted" style={{ fontSize: 12.5, minWidth: 34 }}>{clock(duration)}</span>
        <Button variant="ghost" size="sm" iconOnly aria-label="Forward 10 seconds" onClick={() => seek(current + 10)} icon={<RotateCw size={14} />} />
        <Button variant="ghost" size="sm" aria-label="Playback speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
          <span className="mono">{speed}×</span>
        </Button>
        {!sample && (
          <a className="btn btn--ghost btn--sm btn--icon" href={src} download aria-label="Download recording">
            <Download size={14} />
          </a>
        )}
      </div>
      {loading && !playing && <span className="muted" style={{ fontSize: 12.5 }}>Fetching the recording…</span>}
      {error && (
        <span className="row" style={{ fontSize: 12.5, color: 'var(--danger)' }}>
          <AlertTriangle size={14} /> {error}
          <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={retry}>Try again</Button>
        </span>
      )}
      {sample && <span className="muted" style={{ fontSize: 12.5 }}>Demo call — this plays a stand-in clip, not a real recording.</span>}
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          setCurrent(e.currentTarget.currentTime);
          onTime?.(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onError={() => setError(src.startsWith('/api/') ? 'The recording is not available yet — try again in a minute.' : 'This recording could not be played.')}
      />
    </div>
  );
}
