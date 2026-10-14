// The agent's phone line for the whole signed-in session. Mounted once around the agent's pages (not inside
// one page), so a live call keeps going while the agent opens the customer's history, and an ended call waits
// for its outcome wherever the agent is.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TelephonyProvider, useTelephony, type CallResult } from '../../telephony';
import { useStore } from '../../store/StoreContext';
import type { CustomerUser } from '../../data/types';
import { hasRealRecording } from '../../lib/attachRecording';
import { DEFAULT_COUNTRY_CODE, LIVE_DIAL_BLOCKED, callMeta, dialNumberFor, telephonyProvider } from '../../lib/telephony';
import { analyzeCall, AnalysisUnavailable } from '../../lib/transcription';
import { CallSessionContext, type CallSessionValue } from './callSessionContext';

// The mock line needs no login; a real provider makes the agent sign in through the phone panel.
const MOCK_CREDENTIALS = { userId: 'mock-agent', password: '' };

const DIAL_ERROR = {
  'invalid-number': 'That doesn’t look like a valid phone number.',
  'not-ready': 'The phone line is not connected yet — sign in to the softphone first.',
  'call-in-progress': 'Finish the current call first.',
} as const;

const LOOKUP_DELAYS_MS = [15_000, 60_000, 180_000, 600_000];

function Session({ children }: { children: ReactNode }) {
  const { controller, snapshot } = useTelephony();
  const { state, dispatch, currentAgent } = useStore();
  const [wrapUp, setWrapUp] = useState<CallSessionValue['wrapUp']>(null);
  const wrapRef = useRef(wrapUp);
  wrapRef.current = wrapUp;

  // A finished call waits here until the agent logs it.
  useEffect(
    () =>
      controller.onCallEnded((result: CallResult) => {
        const customerId = result.meta.customerId;
        if (customerId) setWrapUp({ result, customerId });
      }),
    [controller],
  );

  // TeleCMI announces the recording after hangup — usually before the agent has finished logging. Unlogged: it rides
  // along with the log entry. Already logged: patch that entry.
  useEffect(
    () =>
      controller.onRecording(({ file, callId, duringCall }) => {
        if (duringCall) return;
        const pending = wrapRef.current;
        if (pending && (!callId || pending.result.providerCallId === callId)) setWrapUp({ ...pending, result: { ...pending.result, recordingFile: file } });
        else dispatch({ type: 'ATTACH_RECORDING', file, callId });
      }),
    [controller, dispatch],
  );

  const myCalls = useMemo(() => {
    if (!currentAgent) return [];
    const since = Date.now() - 24 * 3600_000;
    return state.users.flatMap((user) => user.callHistory.filter((c) => c.agentName === currentAgent.name && c.atTs >= since).map((call) => ({ user, call })));
  }, [state.users, currentAgent]);

  // Logged calls that still have no recording: ask TeleCMI's call records a few times as the file is finalised.
  const lookups = useRef(new Map<string, number>());
  const connection = snapshot.connection;
  useEffect(() => {
    if (connection !== 'ready') return;
    const tick = () => {
      for (const { call } of myCalls) {
        const t = call.telephony;
        if (t?.provider !== 'telecmi' || !t.startedAt || !t.remote || t.durationSec <= 0 || hasRealRecording(t.recordingFile)) continue;
        const tries = lookups.current.get(call.id) ?? 0;
        if (tries >= LOOKUP_DELAYS_MS.length || Date.now() - call.atTs < LOOKUP_DELAYS_MS[tries]) continue;
        lookups.current.set(call.id, tries + 1);
        void controller.findRecording({ remote: t.remote, startedAt: t.startedAt, talkSeconds: t.durationSec }).then((file) => {
          if (file) dispatch({ type: 'ATTACH_RECORDING', file, entryId: call.id });
        });
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [connection, myCalls, controller, dispatch]);

  // Every recorded call gets analysed (transcript, summary, sentiment) once — automatically, in the background.
  const analysing = useRef(new Set<string>());
  useEffect(() => {
    for (const { user, call } of myCalls) {
      if (!hasRealRecording(call.telephony?.recordingFile) || call.analysis || call.analysisError || analysing.current.has(call.id)) continue;
      analysing.current.add(call.id);
      analyzeCall(call, user)
        .then((analysis) => dispatch({ type: 'SET_ANALYSIS', userId: user.id, entryId: call.id, analysis }))
        .catch((e: Error) => dispatch({ type: 'SET_ANALYSIS', userId: user.id, entryId: call.id, error: e instanceof AnalysisUnavailable ? `${e.message}` : e.message }));
    }
  }, [myCalls, dispatch]);

  const dial = useCallback(
    (user: CustomerUser) => {
      if (!currentAgent) return { ok: false as const, message: 'Sign in first.' };
      if (LIVE_DIAL_BLOCKED && !user.adHoc) return { ok: false as const, message: 'Live dialling is off while customer numbers are sample data.' };
      if (wrapRef.current) return { ok: false as const, message: 'Log the last call before starting another.' };
      const r = controller.dial(dialNumberFor(user), callMeta(user, currentAgent));
      return r.ok ? { ok: true as const } : { ok: false as const, message: DIAL_ERROR[r.reason] };
    },
    [controller, currentAgent],
  );

  const clearWrapUp = useCallback(() => {
    setWrapUp(null);
    controller.clearResult();
  }, [controller]);

  const value = useMemo<CallSessionValue>(
    () => ({ available: true, liveCustomerId: snapshot.call?.meta.customerId ?? null, wrapUp, dial, clearWrapUp }),
    [snapshot.call?.meta.customerId, wrapUp, dial, clearWrapUp],
  );
  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

/** Wraps the agent's pages with the phone line. Without a configured provider the pages get the plain fallback. */
export function AgentCallSession({ children }: { children: ReactNode }) {
  if (!telephonyProvider) return <>{children}</>;
  return (
    <TelephonyProvider provider={telephonyProvider} defaultCountryCode={DEFAULT_COUNTRY_CODE} credentials={telephonyProvider.requiresCredentials ? null : MOCK_CREDENTIALS}>
      <Session>{children}</Session>
    </TelephonyProvider>
  );
}
