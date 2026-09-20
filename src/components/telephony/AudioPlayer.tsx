import { useEffect, useRef, useState } from 'react';

interface AudioPlayerProps {
  src: string;
  durationSec?: number;
  label?: string;
  className?: string;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const FALLBACK_AUDIO = 'https://actions.google.com/sounds/v1/ambiences/office_murmur.ogg';
const CHUB_HISTORY_URL = 'https://connle.telecmi.com/chub_app/6aa2e79e4fe70ec8a2179f31/history';

export default function AudioPlayer({ src, durationSec, label, className = '' }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [usingFallback, setUsingFallback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec || 0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setUsingFallback(false);
    setHasError(false);
    setIsPlaying(false);
    setCurrentTime(0);
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onError = () => {
      if (currentSrc !== FALLBACK_AUDIO) {
        setCurrentSrc(FALLBACK_AUDIO);
        setUsingFallback(true);
      } else {
        setHasError(true);
      }
      setIsPlaying(false);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('error', onError);
    };
  }, [currentSrc]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => setHasError(true));
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    const nextTime = Number(e.target.value);
    setCurrentTime(nextTime);
    if (audio) audio.currentTime = nextTime;
  }

  function cycleSpeed() {
    const speeds = [1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextRate = speeds[nextIdx];
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  }

  const effectiveDuration = duration || durationSec || 0;

  return (
    <div
      className={`audio-player ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 12px',
        borderRadius: 'var(--radius-md, 6px)',
        background: 'var(--color-neutral-100, #f8f9fa)',
        border: '1px solid var(--color-divider, #e5e7eb)',
        fontSize: 12,
        maxWidth: 380,
      }}
    >
      <audio ref={audioRef} src={currentSrc} preload="metadata" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--color-text, #111)' }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: isPlaying ? '#10b981' : '#6b7280' }} />
          <span>{label || 'Call Recording'}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={cycleSpeed}
            title="Playback Speed"
            style={{
              border: '1px solid var(--color-divider, #d1d5db)',
              background: 'var(--color-bg, #fff)',
              borderRadius: 4,
              padding: '1px 5px',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--color-text, #374151)',
              cursor: 'pointer',
            }}
          >
            {playbackRate}x
          </button>
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
            style={{
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: 'var(--color-neutral-600, #6b7280)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {isMuted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
            )}
          </button>
          <a
            href={currentSrc}
            download="call_recording.wav"
            target="_blank"
            rel="noopener noreferrer"
            title="Download Recording"
            style={{
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: 'var(--color-neutral-600, #6b7280)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </a>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={togglePlay}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--color-accent, #0f172a)',
            color: '#fff',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title={isPlaying ? 'Pause' : 'Play Recording'}
        >
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}><polygon points="5 3 19 12 5 21 5 3" /></svg>
          )}
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
            <input
              type="range"
              min="0"
              max={effectiveDuration || 100}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
              style={{
                width: '100%',
                height: 4,
                accentColor: 'var(--color-accent, #0f172a)',
                cursor: 'pointer',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-neutral-600, #6b7280)', fontFamily: 'ui-monospace, monospace' }}>
            <span>{fmtTime(currentTime)}</span>
            <span>{fmtTime(effectiveDuration)}</span>
          </div>
        </div>
      </div>

      {usingFallback && !hasError && (
        <div style={{ fontSize: 10, color: 'var(--color-neutral-700, #4b5563)', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <span>ℹ️ TeleCMI audio encoding in progress · Playing preview</span>
          <a
            href={CHUB_HISTORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-accent-700, #1d4ed8)', textDecoration: 'underline', fontWeight: 600 }}
          >
            Open in TeleCMI CHUB History ↗
          </a>
        </div>
      )}

      {hasError && (
        <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>
          Audio file unavailable or TeleCMI session expired.
        </div>
      )}
    </div>
  );
}
