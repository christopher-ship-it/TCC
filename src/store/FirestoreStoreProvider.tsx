import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  deleteField,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, ensureFirebaseAuth } from '../firebase/client';
import { agentDoc, agentsRef, clearedEscalationsRef, escalationDoc, escalationsRef, overlayDoc, overlayRef } from '../firebase/collections';
import { stripUndefined } from '../firebase/util';
import { AGENTS, generateRealtimeAnalytics, generateSeed } from '../data/seed';
import type { AgentAccount, CustomerOverlay, CustomerUser, EscalationRecord } from '../data/types';
import { NEGATIVE_OUTCOMES } from '../data/types';
import { fmtDay, fmtDayTime } from '../lib/dates';
import { isReachable } from '../lib/queue';
import { buildTeleCmiRecordingUrl } from '../lib/telephony';
import { StoreContext, type Action, type State } from './context';

const DAY_MS = 86400000;
const SESSION_KEY = 'tcc-session-agent-id';

// Only the master customer records are generated locally for now (pending the
// existing app database being wired in). Agents and everything an agent does
// to a customer record — call logs, tickets, follow-ups, escalations — is
// live Firestore data in the dedicated TCC project.
const master = generateSeed();

export function FirestoreStoreProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<AgentAccount[] | null>(null);
  const [overlayMap, setOverlayMap] = useState<Record<string, CustomerOverlay>>({});
  const [escalations, setEscalations] = useState<EscalationRecord[]>([]);
  const [clearedEscalations, setClearedEscalations] = useState<State['clearedEscalations']>([]);
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [authReady, setAuthReady] = useState(false);

  const users: CustomerUser[] = useMemo(
    () => master.users.map((u) => (overlayMap[u.id] ? { ...u, ...overlayMap[u.id] } : u)),
    [overlayMap],
  );

  const usersRef = useRef(users);
  usersRef.current = users;
  const agentsRefLive = useRef(agents);
  agentsRefLive.current = agents;
  const escalationsRefLive = useRef(escalations);
  escalationsRefLive.current = escalations;

  // Auth: TCC accounts aren't Firebase Auth users (they're TCC's own username
  // records below), so this just gets an authenticated request context so
  // Firestore rules can require `request.auth != null` without per-agent
  // Firebase credentials.
  useEffect(() => {
    ensureFirebaseAuth().finally(() => setAuthReady(true));
  }, []);

  // Bootstrap: if the agents collection is empty (fresh project), seed it
  // once with the sample roster so login works immediately. Safe to run more
  // than once — it only writes when the collection is genuinely empty.
  useEffect(() => {
    if (!authReady || !db) return;
    getDocs(agentsRef()).then((snap) => {
      if (!snap.empty) return;
      const batch = writeBatch(db!);
      for (const a of AGENTS) {
        const { id, ...rest } = a;
        batch.set(agentDoc(id), stripUndefined(rest));
      }
      return batch.commit();
    }).catch((err) => console.error('Agent bootstrap failed', err));
  }, [authReady]);

  useEffect(() => {
    if (!authReady || !db) return;
    const unsubs = [
      onSnapshot(agentsRef(), (snap) => {
        setAgents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AgentAccount, 'id'>) })));
      }, (err) => console.error('agents snapshot error', err)),
      onSnapshot(overlayRef(), (snap) => {
        const map: Record<string, CustomerOverlay> = {};
        snap.forEach((d) => { map[d.id] = d.data() as CustomerOverlay; });
        setOverlayMap(map);
      }, (err) => console.error('overlay snapshot error', err)),
      onSnapshot(query(escalationsRef(), orderBy('raisedTs', 'desc')), (snap) => {
        setEscalations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EscalationRecord, 'id'>) })));
      }, (err) => console.error('escalations snapshot error', err)),
      onSnapshot(query(clearedEscalationsRef(), orderBy('resolvedTs', 'desc'), limit(20)), (snap) => {
        setClearedEscalations(snap.docs.map((d) => {
          const data = d.data() as any;
          return { id: d.id, atLabel: data.atLabel, name: data.name, action: data.action, result: data.result, minutes: data.minutes };
        }));
      }, (err) => console.error('clearedEscalations snapshot error', err)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [authReady]);

  function writeOverlay(userId: string, patch: Partial<CustomerOverlay> & Record<string, unknown>) {
    setDoc(overlayDoc(userId), stripUndefined(patch), { merge: true }).catch((err) => console.error('overlay write failed', err));
  }

  async function dispatch(action: Action) {
    switch (action.type) {
      case 'LOGIN': {
        setCurrentAgentId(action.agentId);
        localStorage.setItem(SESSION_KEY, action.agentId);
        updateDoc(agentDoc(action.agentId), { lastActiveLabel: 'now' }).catch(() => {});
        return;
      }
      case 'LOGOUT': {
        setCurrentAgentId(null);
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      case 'LOG_CALL': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        const agent = agentsRefLive.current?.find((a) => a.id === action.agentId);
        if (!user) return;
        const now = Date.now();
        const isAnswered = action.status.startsWith('Answered') || (action.telephony?.durationSec ?? 0) > 0;
        const durationSec = action.telephony?.durationSec ?? (isAnswered ? 45 : 0);
        const recFile = action.telephony?.recordingFile ?? (isAnswered ? `rec_${now}.wav` : undefined);
        const telephony = action.telephony ?? (isAnswered ? {
          provider: 'telecmi',
          callId: `cmi-${now}`,
          durationSec,
          ringSec: 12,
          disposition: 'answered',
          recordingFile: recFile,
          recordingUrl: recFile ? buildTeleCmiRecordingUrl(recFile) : undefined,
        } : undefined);

        const analytics = action.analytics ?? (isAnswered
          ? generateRealtimeAnalytics(agent?.name ?? 'You', user.name, user.app, action.outcome, durationSec)
          : undefined);

        const entry = {
          id: `cl-${now}-${Math.random().toString(36).slice(2, 7)}`,
          atTs: now,
          atLabel: fmtDayTime(now),
          agentName: agent?.name ?? 'You',
          status: action.status,
          outcome: action.outcome,
          comment: action.comment,
          telephony,
          analytics,
        };
        const callHistory = [entry, ...user.callHistory];

        if (!action.outcome) {
          writeOverlay(user.id, { callHistory, attempt: user.attempt + 1 });
          return;
        }
        if (NEGATIVE_OUTCOMES.includes(action.outcome)) {
          await setDoc(overlayDoc(user.id), stripUndefined({ callHistory, queue: null, stageTag: 'Exited — negative' }), { merge: true });
          await updateDoc(overlayDoc(user.id), { followUp: deleteField() });
          return;
        }
        if (action.outcome === 'Ready to subscribe') {
          await setDoc(overlayDoc(user.id), stripUndefined({ callHistory, queue: null, paying: true, plan: 'Paid', stageTag: 'Converted', mrr: user.mrr ?? 999 }), { merge: true });
          await updateDoc(overlayDoc(user.id), { followUp: deleteField() });
          return;
        }
        if (action.outcome === 'Payment issue') {
          writeOverlay(user.id, { callHistory, queue: 'payments', stageTag: 'Overdue', paymentDue: user.paymentDue ?? { amount: 999, dueLabel: fmtDay(now - DAY_MS), status: 'overdue' } });
          return;
        }
        if (action.outcome === 'Technical issue') {
          writeOverlay(user.id, { callHistory, queue: 'errors', stageTag: 'Technical issue' });
          return;
        }
        const prevWeek = user.followUp?.weekNumber ?? 0;
        writeOverlay(user.id, {
          callHistory,
          queue: 'followup',
          stageTag: 'Hot lead',
          followUp: { weekNumber: prevWeek + 1, nextDueLabel: fmtDay(now + 7 * DAY_MS), markedPositiveLabel: fmtDay(now), state: 'pending' },
        });
        return;
      }
      case 'RAISE_TICKET': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        if (!user) return;
        const ticket = { id: `tk-${Date.now()}`, subject: action.subject, raisedAtLabel: fmtDay(Date.now()), slaBreached: false };
        writeOverlay(user.id, { tickets: [ticket, ...user.tickets], queue: 'tickets', stageTag: 'Open ticket' });
        return;
      }
      case 'REQUEST_REROUTE': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        if (!user) return;
        const payload = {
          type: 'reroute' as const, userId: user.id, userName: user.name, userCity: `${user.city}, ${user.effectiveState}`, app: user.app,
          raisedAtLabel: fmtDayTime(Date.now()).split(' · ')[1], raisedTs: Date.now(), raisedByAgentId: action.agentId,
          reason: action.note, targetLanguage: action.targetLanguage, suggestedOwnerId: action.suggestedOwnerId, note: action.note, status: 'pending' as const,
        };
        await addDoc(escalationsRef(), stripUndefined(payload));
        writeOverlay(user.id, { hasActiveEscalation: true });
        return;
      }
      case 'REQUEST_ESCALATE': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        if (!user) return;
        const payload = {
          type: 'escalation' as const, userId: user.id, userName: user.name, userCity: `${user.city}, ${user.effectiveState}`, app: user.app,
          raisedAtLabel: fmtDayTime(Date.now()).split(' · ')[1], raisedTs: Date.now(), raisedByAgentId: action.agentId,
          reason: action.reason, urgency: action.urgency, note: action.note, status: 'pending' as const,
        };
        await addDoc(escalationsRef(), stripUndefined(payload));
        writeOverlay(user.id, { hasActiveEscalation: true });
        return;
      }
      case 'APPROVE_ESCALATION':
      case 'DECLINE_ESCALATION': {
        const esc = escalationsRefLive.current.find((e) => e.id === action.id);
        if (!esc) return;
        const approved = action.type === 'APPROVE_ESCALATION';
        const status = approved ? 'approved' : 'declined';
        await updateDoc(escalationDoc(action.id), stripUndefined({ status, resolutionNote: action.resolutionNote, resolvedLabel: fmtDayTime(Date.now()) }));

        const stillPending = escalationsRefLive.current.some((e) => e.userId === esc.userId && e.status === 'pending' && e.id !== esc.id);
        const overlayPatch: Record<string, unknown> = { hasActiveEscalation: stillPending };
        if (approved) {
          const reassignAgentId = (action as { reassignAgentId?: string }).reassignAgentId;
          if (reassignAgentId) overlayPatch.ownerAgentId = reassignAgentId;
          if (esc.type === 'reroute' && esc.targetLanguage) overlayPatch.language = esc.targetLanguage;
        }
        writeOverlay(esc.userId, overlayPatch);

        await addDoc(clearedEscalationsRef(), stripUndefined({
          atLabel: fmtDayTime(Date.now()).split(' · ')[1],
          resolvedTs: Date.now(),
          name: esc.userName,
          action: esc.type === 'reroute' ? `Reroute → ${esc.targetLanguage}` : `Escalation → ${esc.reason}`,
          result: approved ? 'Approved · reassigned' : 'Declined · kept with agent',
          minutes: Math.round((Date.now() - esc.raisedTs) / 60000) || 5,
        }));
        return;
      }
      case 'CREATE_AGENT': {
        const { id, ...rest } = action.agent;
        await setDoc(agentDoc(id), stripUndefined(rest));
        return;
      }
      case 'UPDATE_AGENT_QUEUES':
        await updateDoc(agentDoc(action.agentId), { queues: action.queues });
        return;
      case 'UPDATE_AGENT_ALLOCATION':
        await updateDoc(agentDoc(action.agentId), { languages: action.languages, states: action.states });
        return;
      case 'REASSIGN_OWNER':
        writeOverlay(action.userId, { ownerAgentId: action.agentId });
        return;
      case 'CLOSE_FOLLOWUP': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        await setDoc(overlayDoc(action.userId), stripUndefined({
          queue: null,
          stageTag: action.converted ? 'Converted' : 'Exited — negative',
          paying: action.converted ? true : user?.paying,
          plan: action.converted ? 'Paid' : user?.plan,
          mrr: action.converted ? (user?.mrr ?? 999) : user?.mrr,
        }), { merge: true });
        await updateDoc(overlayDoc(action.userId), { followUp: deleteField() });
        return;
      }
      case 'AUTO_DISTRIBUTE': {
        if (!db) return;
        const targets = usersRef.current.filter((u) => !u.ownerAgentId && u.queue);
        const pool = (agentsRefLive.current ?? []).filter((a) => a.role === 'agent');
        let batch = writeBatch(db);
        let count = 0;
        for (const u of targets) {
          const owner = pool.find((a) => a.queues.includes(u.queue!) && isReachable(a, u));
          if (!owner) continue;
          batch.set(overlayDoc(u.id), { ownerAgentId: owner.id }, { merge: true });
          count += 1;
          if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
          }
        }
        if (count % 400 !== 0) await batch.commit();
        return;
      }
      case 'RESET':
        // No-op on live shared data — resetting would wipe the whole team's
        // real records. Nothing in the UI calls this on the Firestore backend.
        console.warn('RESET is disabled once connected to Firestore.');
        return;
      default:
        return;
    }
  }

  const currentAgent = useMemo(() => (agents ?? []).find((a) => a.id === currentAgentId) ?? null, [agents, currentAgentId]);

  const state: State = {
    agents: agents ?? [],
    users,
    escalations,
    clearedEscalations,
    apps: master.apps,
    states: master.states,
    currentAgentId,
  };

  const value = useMemo(
    () => ({ state, dispatch: dispatch as unknown as React.Dispatch<Action>, currentAgent, ready: agents !== null, backend: 'firestore' as const }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, users, escalations, clearedEscalations, currentAgentId, currentAgent],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
