// Who is signed in to TCC right now, and who may sign whom out (not the phone line's availability: that is presence.ts). Plain functions: the server and the screens both use them.
/** A person counts as online while their browser has talked to the server in the last 15 minutes. */
export const ONLINE_MINUTES = 15;

export const isOnline = (lastSeen: number | null | undefined, sessions: number, now = Date.now()): boolean =>
  sessions > 0 && typeof lastSeen === 'number' && now - lastSeen < ONLINE_MINUTES * 60_000;

/** Tecstellar's super admin can sign anyone out; a client admin their own agents and supervisors, never another admin. */
type Who = { id: string; role: string; superAdmin?: boolean; apps: readonly string[] };

export function canSignOut(me: Who, target: Who): boolean {
  if (me.id === target.id) return false;
  if (me.superAdmin) return true;
  if (me.role !== 'admin') return false;
  return !target.superAdmin && target.role !== 'admin' && target.apps.some((a) => me.apps.includes(a));
}

export interface PresenceRow {
  id: string;
  name: string;
  role: string;
  apps: string[];
  languages: string[];
  status?: string;
  lastSeen: number | null;
  sessions: number;
  online: boolean;
  canSignOut: boolean;
  /** What their softphone is doing right now; null when no call is going. */
  call?: { state: 'dialing' | 'ringing' | 'incoming' | 'connected'; customerId: string | null; since: number } | null;
}
