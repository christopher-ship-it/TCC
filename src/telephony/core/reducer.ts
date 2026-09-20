import type { CallResult, CallSession, CallSnapshot, Disposition, MediaStats, Meta, ProviderEvent } from './types.ts';

export type Action =
  | { type: 'connecting' }
  | { type: 'dial'; id: string; remote: string; meta: Meta; now: number }
  | { type: 'hangupRequested' }
  | { type: 'forceEnd'; now: number }
  | { type: 'setMuted'; muted: boolean }
  | { type: 'clearError' }
  | { type: 'clearResult' }
  | { type: 'event'; event: ProviderEvent; now: number };

export function initialSnapshot(provider: string): CallSnapshot {
  return { provider, connection: 'disconnected', connectionError: null, call: null, lastResult: null, error: null };
}

const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));

/**
 * Maps how an unanswered call ended onto a Disposition. Codes are SIP-style
 * (what TeleCMI reports on `ended`: 408, 480, 484, 486 …).
 *
 * ASSUMPTION to verify on live calls: piopiyjs reports code 200 for "ended"
 * when the underlying failure carried no SIP message — that includes its own
 * ring-timeout, so 200-on-unanswered is treated as no-answer.
 */
function classify(call: CallSession, hint: { code?: number; local?: boolean }): Disposition {
  if (call.answeredAt !== null) return 'connected';
  if (hint.local || call.hangupRequested) return call.direction === 'outbound' ? 'cancelled' : 'rejected';
  switch (hint.code) {
    case 486:
    case 600:
      return 'busy';
    case 408:
    case 487:
    case 200:
    case undefined:
      return 'no-answer';
    case 480:
    case 404:
    case 410:
    case 484:
    case 604:
      return 'unreachable';
    case 403:
    case 603:
      return 'rejected';
    default:
      return 'failed';
  }
}

function finish(state: CallSnapshot, now: number, hint: { code?: number; local?: boolean; stats?: MediaStats; recordingBlobUrl?: string }): CallSnapshot {
  const call = state.call;
  if (!call) return state;
  const result: CallResult = {
    id: call.id,
    provider: state.provider,
    providerCallId: call.providerCallId,
    direction: call.direction,
    remote: call.remote,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: now,
    ringSeconds: seconds((call.answeredAt ?? now) - call.startedAt),
    talkSeconds: call.answeredAt !== null ? seconds(now - call.answeredAt) : 0,
    disposition: classify(call, hint),
    endCode: hint.code ?? null,
    meta: call.meta,
    stats: hint.stats ?? call.stats,
    recordingBlobUrl: hint.recordingBlobUrl,
  };
  return { ...state, call: null, lastResult: result };
}

function withCall(state: CallSnapshot, patch: Partial<CallSession>): CallSnapshot {
  return state.call ? { ...state, call: { ...state.call, ...patch } } : state;
}

function withCallId(state: CallSnapshot, callId?: string): CallSnapshot {
  return callId && state.call && !state.call.providerCallId ? withCall(state, { providerCallId: callId }) : state;
}

function reduceEvent(state: CallSnapshot, event: ProviderEvent, now: number): CallSnapshot {
  const call = state.call;
  switch (event.type) {
    case 'ready':
      return { ...state, connection: 'ready', connectionError: null };
    case 'connectFailed':
      return { ...state, connection: 'failed', connectionError: { code: event.code, reason: event.reason } };
    case 'disconnected':
      // A dropped signalling socket doesn't necessarily kill media; the call is
      // left to end via its own events (or the hangup watchdog).
      return { ...state, connection: 'disconnected' };
    case 'trying':
      return withCallId(state, event.callId);
    case 'ringing': {
      if (!call) return state;
      const next = call.state === 'dialing' ? withCall(state, { state: 'ringing' }) : state;
      return withCallId(next, event.callId);
    }
    case 'incoming':
      if (call) return state; // single-session provider: ignore a second inbound
      return {
        ...state,
        error: null,
        call: {
          id: event.callId ?? `in-${now}`,
          providerCallId: event.callId ?? null,
          direction: 'inbound',
          remote: event.from,
          state: 'incoming',
          startedAt: now,
          answeredAt: null,
          muted: false,
          held: false,
          remoteHeld: false,
          hangupRequested: false,
          meta: event.team ? { team: event.team } : {},
          stats: null,
        },
      };
    case 'answered': {
      if (!call) return state;
      const next = call.answeredAt === null ? withCall(state, { state: 'connected', answeredAt: now }) : state; // SDK can emit twice
      return withCallId(next, event.callId);
    }
    case 'hold':
      return event.whom === 'self' ? withCall(state, { held: event.on }) : withCall(state, { remoteHeld: event.on });
    case 'stats':
      return call ? withCall(state, { stats: event.stats }) : state;
    case 'ended':
      return finish(state, now, { code: event.code, local: event.localHangup, stats: event.stats, recordingBlobUrl: event.recordingBlobUrl });
    case 'mediaFailed': {
      const failed = finish(state, now, { code: 415 });
      return { ...failed, error: { code: 415, message: event.message } };
    }
    case 'error': {
      const withError = { ...state, error: { code: event.code, message: event.message } };
      // An error before the provider has even started ringing means the call never left the building.
      return call?.state === 'dialing' ? finish(withError, now, { code: event.code }) : withError;
    }
  }
}

export function reduce(state: CallSnapshot, action: Action): CallSnapshot {
  switch (action.type) {
    case 'connecting':
      return { ...state, connection: 'connecting', connectionError: null };
    case 'dial':
      if (state.call) return state;
      return {
        ...state,
        error: null,
        lastResult: null,
        call: {
          id: action.id,
          providerCallId: null,
          direction: 'outbound',
          remote: action.remote,
          state: 'dialing',
          startedAt: action.now,
          answeredAt: null,
          muted: false,
          held: false,
          remoteHeld: false,
          hangupRequested: false,
          meta: action.meta,
          stats: null,
        },
      };
    case 'hangupRequested':
      return state.call && !state.call.hangupRequested ? withCall(state, { hangupRequested: true }) : state;
    case 'forceEnd':
      return finish(state, action.now, { local: true });
    case 'setMuted':
      return state.call && state.call.muted !== action.muted ? withCall(state, { muted: action.muted }) : state;
    case 'clearError':
      return state.error ? { ...state, error: null } : state;
    case 'clearResult':
      return state.lastResult ? { ...state, lastResult: null } : state;
    case 'event':
      return reduceEvent(state, action.event, action.now);
  }
}
