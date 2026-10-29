import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  deleteField,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { authMessage, createLogin, db, sendReset, signInWithPassword, signOutOfFirebase, watchAuth } from '../firebase/client';
import { agentDoc, agentsRef, auditRef, authLinkDoc, clearedEscalationsRef, customerMasterDoc, customersMasterRef, escalationDoc, escalationsRef, overlayDoc, overlayRef } from '../firebase/collections';
import { stripUndefined } from '../firebase/util';
import { generateSeed } from '../data/seed';
import type { AgentAccount, AuditAction, AuditEntry, CustomerOverlay, CustomerUser, EscalationRecord } from '../data/types';
import { NEGATIVE_OUTCOMES } from '../data/types';
import { fmtDay, fmtDayTime } from '../lib/dates';
import { isReachable } from '../lib/queue';
import { attachRecording, withAnalysis } from '../lib/attachRecording';
import { buildCallLogEntry } from '../lib/callLog';
import { recordingUrlFor } from '../lib/telephony';
import { auditEntry, BaseStoreContext, type AccountResult, type Action, type State } from './context';

const DAY_MS = 86400000;

// Sample fallback only — used until an admin imports real customers (People/admin › Customers),
// at which point customersMasterRef() is non-empty and wins. Agents and everything an agent does to
// a customer record — call logs, tickets, follow-ups, escalations — is live Firestore data either way.
const sampleSeed = generateSeed();

export function FirestoreStoreProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<AgentAccount[] | null>(null);
  const [masterCustomers, setMasterCustomers] = useState<CustomerUser[] | null>(null);
  const [overlayMap, setOverlayMap] = useState<Record<string, CustomerOverlay>>({});
  const [escalations, setEscalations] = useState<EscalationRecord[]>([]);
  const [clearedEscalations, setClearedEscalations] = useState<State['clearedEscalations']>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  // undefined = still checking who is signed in; null = nobody.
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined);
  // The TCC person this login is linked to (authLinks/{uid}); undefined while it is being looked up.
  const [currentAgentId, setCurrentAgentId] = useState<string | null | undefined>(undefined);
  const [accessProblem, setAccessProblem] = useState<string | null>(null);
  const signedInLogged = useRef(false);

  // Numbers dialled directly are master docs too, but they must not switch the sample set off.
  const importedCustomers = useMemo(() => (masterCustomers ?? []).filter((u) => !u.adHoc), [masterCustomers]);
  const customerSource: 'sample' | 'imported' = importedCustomers.length > 0 ? 'imported' : 'sample';
  const master = useMemo(
    () => [...(customerSource === 'imported' ? importedCustomers : sampleSeed.users), ...(masterCustomers ?? []).filter((u) => u.adHoc)],
    [customerSource, importedCustomers, masterCustomers],
  );

  const users: CustomerUser[] = useMemo(
    () => master.map((u) => (overlayMap[u.id] ? { ...u, ...overlayMap[u.id] } : u)),
    [master, overlayMap],
  );

  const usersRef = useRef(users);
  usersRef.current = users;
  const agentsRefLive = useRef(agents);
  agentsRefLive.current = agents;
  const escalationsRefLive = useRef(escalations);
  escalationsRefLive.current = escalations;

  useEffect(() => watchAuth(setAuthUser), []);

  // A login only means something once it is linked to a TCC person (authLinks/{uid}, written by an admin).
  useEffect(() => {
    if (authUser === undefined) return;
    if (!authUser) {
      setCurrentAgentId(null);
      setAgents(null);
      return;
    }
    let cancelled = false;
    setCurrentAgentId(undefined);
    getDoc(authLinkDoc(authUser.uid))
      .then((snap) => {
        if (cancelled) return;
        const agentId = snap.exists() ? (snap.data().agentId as string | undefined) : undefined;
        if (!agentId) {
          setAccessProblem('This login is not linked to a Command Center account yet. Ask your admin.');
          void signOutOfFirebase();
          return;
        }
        setAccessProblem(null);
        signedInLogged.current = false;
        setCurrentAgentId(agentId);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('authLinks lookup failed', err);
        setAccessProblem('Could not load your account. Check your connection and try again.');
        void signOutOfFirebase();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  const listening = !!db && !!authUser && !!currentAgentId;
  useEffect(() => {
    if (!listening) return;
    const unsubs = [
      onSnapshot(agentsRef(), (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AgentAccount, 'id'>) }));
        const me = list.find((a) => a.id === currentAgentId);
        if (!me || me.status === 'suspended') {
          setAccessProblem(me ? 'This account is suspended. Ask your admin to reactivate it.' : 'Your account was removed. Ask your admin.');
          void signOutOfFirebase();
          return;
        }
        setAgents(list);
        if (!signedInLogged.current) {
          signedInLogged.current = true;
          agentsRefLive.current = list;
          updateDoc(agentDoc(me.id), { lastActiveLabel: 'now' }).catch(() => {});
          writeAudit(me.id, 'signed_in', undefined, 'Signed in');
        }
      }, (err) => {
        // Rules turn a suspended or unlinked person into permission errors.
        console.error('agents snapshot error', err);
        setAccessProblem('Your access has been turned off. Ask your admin.');
        void signOutOfFirebase();
      }),
      onSnapshot(customersMasterRef(), (snap) => {
        setMasterCustomers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerUser, 'id'>) })));
      }, (err) => console.error('customersMaster snapshot error', err)),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, currentAgentId]);

  // The change log is for supervisors and admins (firestore.rules); agents never ask for it.
  const myRole = (agents ?? []).find((a) => a.id === currentAgentId)?.role;
  const readsAudit = myRole === 'admin' || myRole === 'supervisor';
  useEffect(() => {
    if (!listening || !readsAudit) {
      setAudit([]);
      return;
    }
    return onSnapshot(query(auditRef(), orderBy('ts', 'desc'), limit(500)), (snap) => {
      setAudit(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditEntry, 'id'>) })));
    }, (err) => console.error('audit snapshot error', err));
  }, [listening, readsAudit]);

  function writeOverlay(userId: string, patch: Partial<CustomerOverlay> & Record<string, unknown>) {
    setDoc(overlayDoc(userId), stripUndefined(patch), { merge: true }).catch((err) => console.error('overlay write failed', err));
  }

  function writeAudit(actorId: string, action: AuditAction, target: string | undefined, detail: string) {
    const { id, ...entry } = auditEntry(agentsRefLive.current ?? [], actorId, action, target, detail);
    void id;
    addDoc(auditRef(), stripUndefined(entry)).catch((err) => console.error('audit write failed', err));
  }

  async function dispatch(action: Action) {
    switch (action.type) {
      case 'LOGIN':
        // Signing in is signInWithPassword() on this backend; the demo "pick a person" login does not exist here.
        return;
      case 'LOGOUT': {
        if (currentAgentId) writeAudit(currentAgentId, 'signed_out', undefined, 'Signed out');
        await signOutOfFirebase();
        return;
      }
      case 'ATTACH_RECORDING': {
        const hit = attachRecording(usersRef.current, action.file, recordingUrlFor(action.file), action.callId, Date.now(), action.entryId);
        if (hit) writeOverlay(hit.userId, { callHistory: hit.callHistory });
        return;
      }
      case 'SET_ANALYSIS': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        if (user) writeOverlay(user.id, { callHistory: withAnalysis(user.callHistory, action.entryId, action.analysis, action.error) });
        return;
      }
      case 'LOG_CALL': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        const agent = agentsRefLive.current?.find((a) => a.id === action.agentId);
        if (!user) return;
        const now = Date.now();
        const entry = buildCallLogEntry(now, agent?.name ?? 'You', user, action);
        const callHistory = [entry, ...user.callHistory];
        if (action.lead) writeOverlay(user.id, { lead: action.lead });

        if (!action.outcome) {
          // A call they made to us is not one of our attempts at reaching them.
          writeOverlay(user.id, action.telephony?.direction === 'inbound' ? { callHistory } : { callHistory, attempt: user.attempt + 1 });
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
        writeAudit(action.actorId, approved ? 'escalation_approved' : 'escalation_declined', esc.userName, action.resolutionNote || status);
        return;
      }
      case 'UPDATE_AGENT': {
        const target = agentsRefLive.current?.find((a) => a.id === action.agentId);
        await updateDoc(agentDoc(action.agentId), stripUndefined(action.patch as Record<string, unknown>));
        writeAudit(action.actorId, action.auditAction ?? 'access_changed', target?.name, action.detail);
        return;
      }
      case 'REASSIGN_OWNER': {
        writeOverlay(action.userId, { ownerAgentId: action.agentId });
        const user = usersRef.current.find((u) => u.id === action.userId);
        const owner = agentsRefLive.current?.find((a) => a.id === action.agentId);
        writeAudit(action.actorId, 'owner_reassigned', user?.name, `Now owned by ${owner?.name ?? 'nobody'}`);
        return;
      }
      case 'SET_CUSTOMER_TYPE':
        writeOverlay(action.userId, { customerType: action.customerType });
        return;
      case 'SET_LEAD':
        writeOverlay(action.userId, { lead: action.lead });
        return;
      case 'MARK_PAID': {
        const user = usersRef.current.find((u) => u.id === action.userId);
        if (!user) return;
        await setDoc(overlayDoc(user.id), stripUndefined({ paying: true, plan: 'Paid', stageTag: 'Paying', queue: user.queue === 'payments' ? null : user.queue, mrr: user.mrr ?? user.paymentDue?.amount ?? 999 }), { merge: true });
        await updateDoc(overlayDoc(user.id), { paymentDue: deleteField() });
        writeAudit(action.actorId, 'payment_marked_paid', user.name, user.paymentDue ? `₹${user.paymentDue.amount} due ${user.paymentDue.dueLabel}` : 'Marked as paying');
        return;
      }
      case 'LOG_EXPORT':
        writeAudit(action.actorId, 'data_exported', undefined, action.detail);
        return;
      case 'UPDATE_CUSTOMER':
        await setDoc(customerMasterDoc(action.userId), stripUndefined(action.patch), { merge: true });
        return;
      case 'ADD_CUSTOMER': {
        const { id, ...rest } = action.customer;
        if (usersRef.current.some((u) => u.id === id)) return;
        await setDoc(customerMasterDoc(id), stripUndefined(rest));
        return;
      }
      case 'IMPORT_CUSTOMERS': {
        if (!db) return;
        let batch = writeBatch(db);
        let count = 0;
        for (const u of action.customers) {
          const { id, ...rest } = u;
          batch.set(customerMasterDoc(id), stripUndefined(rest));
          count += 1;
          if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
          }
        }
        if (count % 400 !== 0) await batch.commit();
        writeAudit(action.actorId, 'customers_imported', undefined, `Imported ${count} real customers (CSV)`);
        return;
      }
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
        const pool = (agentsRefLive.current ?? []).filter((a) => a.role === 'agent' && (a.status ?? 'active') === 'active');
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
        writeAudit(action.actorId, 'queues_distributed', undefined, `${count} unowned customer${count === 1 ? '' : 's'} given an owner`);
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

  async function signIn(email: string, password: string): Promise<AccountResult> {
    setAccessProblem(null);
    try {
      await signInWithPassword(email, password);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: authMessage(e) };
    }
  }

  async function sendPasswordReset(email: string): Promise<AccountResult> {
    try {
      await sendReset(email);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: authMessage(e) };
    }
  }

  async function createAgent(agent: AgentAccount, actorId: string): Promise<AccountResult> {
    if (!db) return { ok: false, message: 'Firestore is not configured.' };
    const email = agent.email?.trim();
    if (!email) return { ok: false, message: 'An email address is needed so they can sign in.' };
    let uid: string;
    try {
      uid = await createLogin(email);
    } catch (e) {
      return { ok: false, message: authMessage(e) };
    }
    try {
      const { id, ...rest } = agent;
      const batch = writeBatch(db);
      batch.set(agentDoc(id), stripUndefined({ ...rest, email }));
      batch.set(authLinkDoc(uid), { agentId: id });
      await batch.commit();
    } catch (e) {
      console.error('create agent failed', e);
      return { ok: false, message: `The login for ${email} was created but could not be linked (${(e as Error).message}). Link it by hand in the Firebase console, then retry.` };
    }
    writeAudit(actorId, 'user_created', agent.name, `${agent.role} · ${agent.apps.join(', ') || 'no apps'}`);
    return { ok: true };
  }

  const currentAgent = useMemo(() => (agents ?? []).find((a) => a.id === currentAgentId) ?? null, [agents, currentAgentId]);
  // Settled once we know whether anyone is signed in and, if so, who (or why they were turned away).
  const ready = authUser === null || (authUser !== undefined && currentAgentId !== undefined && (currentAgentId === null || agents !== null));

  const state: State = {
    agents: agents ?? [],
    users,
    escalations,
    clearedEscalations,
    audit,
    apps: sampleSeed.apps,
    states: sampleSeed.states,
    currentAgentId: currentAgentId ?? null,
    customerSource,
  };

  const value = useMemo(
    () => ({ state, dispatch: dispatch as unknown as React.Dispatch<Action>, currentAgent, ready, backend: 'firestore' as const, signInWithPassword: signIn, sendPasswordReset, createAgent, accessProblem }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, users, escalations, clearedEscalations, audit, currentAgentId, currentAgent, customerSource, ready, accessProblem],
  );

  return <BaseStoreContext.Provider value={value}>{children}</BaseStoreContext.Provider>;
}
