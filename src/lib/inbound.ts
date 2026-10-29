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
  const hits = users.filter((u) => !u.deleted && apps.includes(u.app) && tail(u.phone) === want);
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
  const existing = users.find((u) => u.id === adHocId(digits) && !u.deleted);
  return existing ? { customer: existing, isNew: false } : { customer: { ...adHocCustomer(digits, apps[0], now), business: 'Incoming call', stageTag: 'Incoming call' }, isNew: true };
}

/**
 * A caller TCC doesn't have on file: ask the server whether a product's own database knows the number
 * (server/appSync.ts). It answers with the customer, already saved; null when nobody knows them, the server can't
 * be reached, or it takes longer than the phone can wait.
 */
export async function lookupCaller(remote: string, apps: AppId[], timeoutMs = 2500): Promise<CustomerUser | null> {
  try {
    const res = await fetch('/api/sources/lookup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: remote }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const found = ((await res.json()) as { customer?: CustomerUser | null }).customer;
    return found && apps.includes(found.app) ? found : null;
  } catch {
    return null;
  }
}
