// Incoming calls: who is calling. A caller is matched to a customer on the last 10 digits of the number; an unknown
// caller gets the same minimal record a dialled-in number does (see directDial.ts), so the call can be logged,
// recorded and analysed like any other.
import type { AppId, CustomerUser } from '../data/types.ts';
import { adHocCustomer, adHocId } from './directDial.ts';

const tail = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** The customer behind a caller's number, among the apps the agent works. A real customer beats a dialled-in record. */
export function matchCaller(users: CustomerUser[], remote: string, apps: AppId[]): CustomerUser | null {
  const want = tail(remote);
  if (want.length < 10) return null;
  const hits = users.filter((u) => apps.includes(u.app) && tail(u.phone) === want);
  return hits.find((u) => !u.adHoc) ?? hits[0] ?? null;
}

/**
 * Who an incoming call is from, among the apps the agent calls for (`apps`, the first one takes unknown callers):
 * the matching customer, or a new record for an unknown number (`isNew` — it still has to be added to the store).
 * Null when there is no app to file it under, or the number is withheld.
 */
export function resolveCaller(users: CustomerUser[], remote: string, apps: AppId[], now = Date.now()): { customer: CustomerUser; isNew: boolean } | null {
  if (!apps.length) return null;
  const known = matchCaller(users, remote, apps);
  if (known) return { customer: known, isNew: false };
  const digits = remote.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const existing = users.find((u) => u.id === adHocId(digits));
  return existing ? { customer: existing, isNew: false } : { customer: { ...adHocCustomer(digits, apps[0], now), business: 'Incoming call', stageTag: 'Incoming call' }, isNew: true };
}
