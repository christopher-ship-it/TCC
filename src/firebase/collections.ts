import { collection, doc } from 'firebase/firestore';
import { db } from './client';

// TCC's own operational data lives in this Firestore project. Customer master
// data (name, phone, plan, etc.) comes from CUSTOMERS_MASTER_COL once an admin
// imports a real CSV (People/admin › Customers); until then it falls back to
// the generated sample set so the app still runs with zero setup.
export const AGENTS_COL = 'agents';
export const CUSTOMERS_MASTER_COL = 'customersMaster';
export const CUSTOMER_OVERLAY_COL = 'customerOverlay';
export const ESCALATIONS_COL = 'escalations';
export const CLEARED_ESCALATIONS_COL = 'clearedEscalations';
export const AUDIT_COL = 'audit';
/** uid of a Firebase Auth login → { agentId }. Written by admins only; it is what ties a login to a TCC person. */
export const AUTH_LINKS_COL = 'authLinks';

export function agentsRef() {
  if (!db) throw new Error('Firestore is not configured');
  return collection(db, AGENTS_COL);
}
export function agentDoc(id: string) {
  if (!db) throw new Error('Firestore is not configured');
  return doc(db, AGENTS_COL, id);
}
export function authLinkDoc(uid: string) {
  if (!db) throw new Error('Firestore is not configured');
  return doc(db, AUTH_LINKS_COL, uid);
}
export function customersMasterRef() {
  if (!db) throw new Error('Firestore is not configured');
  return collection(db, CUSTOMERS_MASTER_COL);
}
export function customerMasterDoc(id: string) {
  if (!db) throw new Error('Firestore is not configured');
  return doc(db, CUSTOMERS_MASTER_COL, id);
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
export function auditRef() {
  if (!db) throw new Error('Firestore is not configured');
  return collection(db, AUDIT_COL);
}
