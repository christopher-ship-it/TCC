// Who is signed in, and what call they are on, refreshed every 20 s while the tab is showing (admins and supervisors only).
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { notesCall } from './notes';
import type { PresenceRow } from './signedIn';

export function usePresence(): { people: PresenceRow[] | null; now: number; error: string | null; reload: () => Promise<void> } {
  const { backend, currentAgent } = useStore();
  const [people, setPeople] = useState<PresenceRow[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const allowed = backend === 'server' && !!currentAgent && currentAgent.role !== 'agent';

  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      const r = await notesCall<{ people: PresenceRow[]; now: number }>('GET', '/api/presence');
      setPeople(r.people);
      setNow(r.now);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load who is signed in.');
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    void reload();
    const id = setInterval(() => document.visibilityState === 'visible' && void reload(), 20_000);
    return () => clearInterval(id);
  }, [allowed, reload]);

  return { people, now, error, reload };
}
