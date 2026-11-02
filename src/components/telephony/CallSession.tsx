// The agent's phone line for the whole signed-in session. Mounted once around the agent's pages (not inside
// one page), so a live call keeps going while the agent opens the customer's history, and an ended call waits
// for its outcome wherever the agent is.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TelephonyProvider, useTelephony, type CallResult } from '../../telephony';
import { useStore } from '../../store/StoreContext';
import type { CustomerUser } from '../../data/types';
import { hasRealRecording } from '../../lib/attachRecording';
import { DEFAULT_COUNTRY_CODE, callMeta, dialBlocked, dialNumberFor, suggestStatus, telephonyProvider, toCallTelephony } from '../../lib/telephony';
import { lookupCaller, resolveCaller } from '../../lib/inbound';
import { report, serverStoreEnabled } from '../../store/ServerStoreProvider';
import { notesCall } from '../../lib/notes';
import { announcePresence } from '../../lib/presence';
import { can } from '../../lib/access';
import { APPS } from '../../data/seed';
import { analyzeCall, AnalysisUnavailable } from '../../lib/transcription';
import { serverRecording } from '../../lib/recordingLookup';
import { CallSessionContext, type CallSessionValue } from './callSessionContext';
import { IncomingCall } from './IncomingCall';
import { CallModal } from './CallModal';

// The mock line needs no login; a real provider makes the agent sign in through the phone panel.
const MOCK_CREDENTIALS = { userId: 'mock-agent', password: '' };

const DIAL_ERROR = {
  'invalid-number': 'That doesn’t look like a valid phone number.',
  'not-ready': 'The phone line is not connected yet — sign in to the softphone first.',
  'call-in-progress': 'Finish the current call first.',
} as const;

// TeleCMI can take well over 10 minutes to publish a recording, so keep asking (every 10 min) for the rest of the 24 h window.
const LOOKUP_DELAYS_MS = [15_000, 60_000, 180_000, 600_000, ...Array.from({ length: 12 }, (_, i) => 900_000 + i * 600_000)];

function Session({ children }: { children: ReactNode }) {
  const { controller, snapshot } = useTelephony();
  const { state, dispatch, currentAgent, account, product } = useStore();
  const [wrapUp, setWrapUp] = useState<CallSessionValue['wrapUp']>(null);
  const wrapRef = useRef(wrapUp);
  wrapRef.current = wrapUp;
  const agentRef = useRef(currentAgent);
  agentRef.current = currentAgent;

  // A call ringing in: work out who it is and tag the call with them, so everything downstream (the phone panel, the
  // call pill, the wrap-up, the log) treats it like a call to that customer. An unknown number gets a minimal record.
  const call = snapshot.call;
  const resolved = useRef<string | null>(null);
  useEffect(() => {
    if (!call || call.direction !== 'inbound' || call.meta.customerId || !currentAgent || resolved.current === call.id) return;
    resolved.current = call.id;
    // The line rings for every product the agent has, not just the one they're signed in to; an unknown caller is
    // filed under the current product.
    const who = account ?? currentAgent;
    const apps = APPS.filter((a) => a.live && can(who, a.id, 'call')).map((a) => a.id).sort((a, b) => Number(b === product) - Number(a === product));
    const caller = resolveCaller(state.users, call.remote, apps);
    if (!caller) return; // withheld number, or an agent with no app to file it under: it still rings, it just can't be logged
    if (caller.isNew && serverStoreEnabled) {
      // Not on file here, but the product's own database may know them (a sign-up since the last sync): ask briefly,
      // and file the call under a new record if not.
      const agentId = currentAgent.id;
      void lookupCaller(call.remote, apps).then((found) => {
        const customer = found ?? caller.customer;
        dispatch({ type: 'ADD_CUSTOMER', customer });
        controller.tag({ customerId: customer.id, app: customer.app, agentId, direction: 'inbound' });
      });
      return;
    }
    if (caller.isNew) dispatch({ type: 'ADD_CUSTOMER', customer: caller.customer });
    controller.tag({ customerId: caller.customer.id, app: caller.customer.app, agentId: currentAgent.id, direction: 'inbound' });
  }, [call, currentAgent, account, product, state.users, dispatch, controller]);

  // A finished call waits here until the agent logs it. A missed or declined incoming call has nothing to wrap up,
  // so it is logged straight away.
  useEffect(
    () =>
      controller.onCallEnded((result: CallResult) => {
        const customerId = result.meta.customerId;
        const agent = agentRef.current;
        if (!customerId || !agent) return;
        const log = (r: CallResult, id: string, comment: string) =>
          dispatch({ type: 'LOG_CALL', userId: id, status: suggestStatus(r), comment, agentId: agent.id, telephony: toCallTelephony(r) });
        if (result.direction === 'inbound' && result.disposition !== 'connected') {
          log(result, customerId, result.disposition === 'rejected' ? 'Declined incoming call' : 'Missed incoming call');
          controller.clearResult();
          return;
        }
        // An incoming call can arrive before the last one was logged; keep that one rather than overwrite it.
        const pending = wrapRef.current;
        if (pending && pending.result.id !== result.id) log(pending.result, pending.customerId, 'Logged automatically — another call came in before this one was logged');
        setWrapUp({ result, customerId });
      }),
    [controller, dispatch],
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

  // The recording for a call: first what TeleCMI's webhook told the server (no softphone session needed), then the
  // softphone's own call records while the line is connected. `note` says why neither had it.
  const connection = snapshot.connection;
  const findRecordingFor = useCallback(
    async (q: { remote: string; startedAt: number; talkSeconds: number; direction?: 'inbound' | 'outbound' }): Promise<{ file?: string; note: string }> => {
      const fromServer = await serverRecording(q);
      if (fromServer) return { file: fromServer, note: '' };
      if (connection !== 'ready') return { note: 'TeleCMI has not announced it to the server yet, and the softphone is not connected to look it up' };
      const file = await controller.findRecording(q);
      return { file, note: file ? '' : `TeleCMI has not announced it to the server yet; softphone lookup: ${controller.lastLookupNote || 'no reason given'}` };
    },
    [connection, controller],
  );

  // Logged calls that still have no recording are looked up as the file is finalised.
  const lookups = useRef(new Map<string, number>());
  useEffect(() => {
    const tick = () => {
      for (const { call } of myCalls) {
        const t = call.telephony;
        if (t?.provider !== 'telecmi' || !t.startedAt || !t.remote || t.durationSec <= 0 || hasRealRecording(t.recordingFile)) continue;
        const tries = lookups.current.get(call.id) ?? 0;
        if (tries >= LOOKUP_DELAYS_MS.length || Date.now() - call.atTs < LOOKUP_DELAYS_MS[tries]) continue;
        lookups.current.set(call.id, tries + 1);
        void findRecordingFor({ remote: t.remote, startedAt: t.startedAt, talkSeconds: t.durationSec, direction: t.direction }).then(({ file, note }) => {
          if (file) return dispatch({ type: 'ATTACH_RECORDING', file, entryId: call.id });
          console.warn(`[phone] No recording found for call ${call.id} (lookup ${tries + 1}/${LOOKUP_DELAYS_MS.length}): ${note}`);
          // The super admin's event log gets the first, a middle and the last attempt — enough to see why, without noise.
          if (serverStoreEnabled && (tries === 0 || tries === 3 || tries === LOOKUP_DELAYS_MS.length - 1)) report('warn', `Recording not found (lookup ${tries + 1}/${LOOKUP_DELAYS_MS.length}): ${note}`, { callId: call.id, remote: t.remote?.slice(-4), startedAt: t.startedAt });
        });
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [myCalls, findRecordingFor, dispatch]);

  // "Look for it now" on a call page: any call, any age, answered with a reason when it is not there yet.
  const checkRecording = useCallback(
    async (entryId: string): Promise<{ found: boolean; message: string }> => {
      const call = state.users.flatMap((u) => u.callHistory).find((c) => c.id === entryId);
      const t = call?.telephony;
      if (!call || t?.provider !== 'telecmi' || !t.startedAt || !t.remote) return { found: false, message: 'This call has nothing to look up.' };
      const { file, note } = await findRecordingFor({ remote: t.remote, startedAt: t.startedAt, talkSeconds: t.durationSec, direction: t.direction });
      if (!file) return { found: false, message: `Not available yet — ${note}.` };
      dispatch({ type: 'ATTACH_RECORDING', file, entryId });
      return { found: true, message: 'Found the recording.' };
    },
    [state.users, findRecordingFor, dispatch],
  );

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
      if (dialBlocked(user, currentAgent)) return { ok: false as const, message: currentAgent.demo ? 'Demo agents can only ring the test number, and none is set.' : 'Live dialling is off while customer numbers are sample data.' };
      if (wrapRef.current) return { ok: false as const, message: 'Log the last call before starting another.' };
      const r = controller.dial(dialNumberFor(user, currentAgent), callMeta(user, currentAgent));
      return r.ok ? { ok: true as const } : { ok: false as const, message: DIAL_ERROR[r.reason] };
    },
    [controller, currentAgent],
  );

  const clearWrapUp = useCallback(() => {
    setWrapUp(null);
    controller.clearResult();
  }, [controller]);

  const attachRecording = useCallback((file: string) => setWrapUp((w) => (w ? { ...w, result: { ...w.result, recordingFile: file } } : w)), []);
  // Completing a call in the card clears it and tells the queue to move on.
  const completeWrapUp = useCallback(() => {
    setWrapUp(null);
    controller.clearResult();
    window.dispatchEvent(new Event('tcc:call-completed'));
  }, [controller]);

  // TeleCMI only rings agents marked online, and it can mark them offline on its own (a dropped connection, the
  // end of a call). So: mark the agent online when the line connects, after each call, and every few minutes.
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const idleOnLine = connection === 'ready' && !snapshot.call;
  useEffect(() => {
    if (!idleOnLine) return;
    let cancelled = false;
    const mark = () => void announcePresence('online').then((err) => !cancelled && setPresenceError(err));
    mark();
    const id = setInterval(mark, 3 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [idleOnLine]);
  useEffect(() => {
    if (connection !== 'ready') setPresenceError(null);
  }, [connection]);
  // Tell the server what the call is doing, so the team's overview can show who is on a call (and with whom).
  const liveState = call?.state ?? null;
  const liveCustomer = call?.meta.customerId ?? null;
  useEffect(() => {
    if (!serverStoreEnabled) return;
    const tell = () => void notesCall('POST', '/api/presence/call', { state: liveState, customerId: liveCustomer }).catch(() => undefined);
    tell();
    if (!liveState) return;
    const id = setInterval(tell, 20_000);
    return () => clearInterval(id);
  }, [liveState, liveCustomer]);
  // Closing or reloading the tab drops the line (the password is not kept), so stop TeleCMI ringing this agent.
  useEffect(() => {
    const off = () => void announcePresence('offline');
    window.addEventListener('pagehide', off);
    return () => window.removeEventListener('pagehide', off);
  }, []);

  const value = useMemo<CallSessionValue>(
    () => ({ available: true, liveCustomerId: snapshot.call?.meta.customerId ?? null, wrapUp, dial, clearWrapUp, completeWrapUp, attachRecording, checkRecording, presenceError }),
    [snapshot.call?.meta.customerId, wrapUp, dial, clearWrapUp, completeWrapUp, attachRecording, checkRecording, presenceError],
  );
  return (
    <CallSessionContext.Provider value={value}>
      {children}
      <IncomingCall />
      <CallModal />
    </CallSessionContext.Provider>
  );
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
