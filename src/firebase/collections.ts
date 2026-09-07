import { collection, doc } from 'firebase/firestore';
import { db } from './client';

// TCC's own operational data lives in this Firestore project. Customer master
// data (name, phone, plan, etc.) is NOT here yet — it still comes from the
// generated sample set until the existing app database is wired in. These
// collections hold only what TCC itself owns: who can log in, and everything
// that happens once an agent starts working a customer record.
export const AGENTS_COL = 'agents';
export const CUSTOMER_OVERLAY_COL = 'customerOverlay';
export const ESCALATIONS_COL = 'escalations';
export const CLEARED_ESCALATIONS_COL = 'clearedEscalations';

export function agentsRef() {
  if (!db) throw new Error('Firestore is not configured');
  return collection(db, AGENTS_COL);
}
export function agentDoc(id: string) {
  if (!db) throw new Error('Firestore is not configured');
  return doc(db, AGENTS_COL, id);
}
export function overlayRef() {
  if (!db) throw new Error('Firestore is not configured');
  return collection(db, CUSTOMER_OVERLAY_COL);
}
export function overlayDoc(id: string) {
  if (!db) throw new Error('Firestore is not configured');
  return doc(db, CUSTOMER_OVERLAY_COL, id);
}
export function escalationsRef() {
  if (!db) throw new Error('Firestore is not configured');
  return collection(db, ESCALATIONS_COL);
}
export function escalationDoc(id: string) {
  if (!db) throw new Error('Firestore is not configured');
  return doc(db, ESCALATIONS_COL, id);
}
export function clearedEscalationsRef() {
  if (!db) throw new Error('Firestore is not configured');
  return collection(db, CLEARED_ESCALATIONS_COL);
}
