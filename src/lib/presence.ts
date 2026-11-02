// The agent's availability in TeleCMI. Its teams only ring agents marked online, and signing the softphone in
// does not mark them — so after the line connects, TCC sets it through its own server (server/presence.ts), which
// holds the App Secret. The softphone login is kept in memory for this tab only (never stored) so the server can
// check it is really that agent.

import { telephonyProvider } from './telephony';

let line: { userId: string; password: string } | null = null;

/** Only the real TeleCMI line has an availability to set; the demo line rings whoever is signed in. */
export const PRESENCE_ENABLED = telephonyProvider?.name === 'telecmi';

export function rememberLine(userId: string, password: string): void {
  line = { userId, password };
}

export function forgetLine(): void {
  line = null;
}

/** Tell TeleCMI whether this agent can take calls. Resolves to null on success, or why it failed. */
export async function announcePresence(status: 'online' | 'offline'): Promise<string | null> {
  if (!PRESENCE_ENABLED || !line) return null;
  try {
    const res = await fetch('/api/telephony/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: line.userId, password: line.password, status }),
      keepalive: status === 'offline', // still delivered if the tab is closing
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? `Status change failed (${res.status}).`;
  } catch {
    return 'Could not reach the server to mark you available.';
  }
}
