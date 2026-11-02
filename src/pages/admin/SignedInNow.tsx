// Who is signed in right now, for the people who run the team. Admins can sign someone out from here (their own agents
// and supervisors); the super admin anyone. The server decides who may (src/lib/signedIn.ts).

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import { notesCall } from '../../lib/notes';
import { usePresence } from '../../lib/usePresence';
import { openLoad } from '../../lib/assignment';
import { textMatch } from '../../lib/filters';
import type { PresenceRow } from '../../lib/signedIn';
import { Badge, Button, Empty } from '../../ui/primitives';
import { ChipFilter, FilterBar, SearchFilter, SelectFilter, useFilters } from '../../ui/filters';
import { useToast } from '../../ui/toastContext';

const ago = (ts: number | null, now: number): string => {
  if (ts === null) return 'Never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
};

const KEYS = ['on_q', 'on_prod', 'on_role', 'on_state'] as const;

export function SignedInNow() {
  const { state, backend } = useStore();
  const toast = useToast();
  const { people, now, error: loadError, reload: load } = usePresence();
  const [confirming, setConfirming] = useState<string | null>(null);
  const { values: f, set, reset, active } = useFilters(KEYS, { on_state: 'online' });

  const held = useMemo(() => openLoad(state.users, Date.now()), [state.users]);

  const rows = useMemo(
    () =>
      (people ?? [])
        .filter((p) => (f.on_state === 'online' ? p.online : f.on_state === 'offline' ? !p.online : true))
        .filter((p) => !f.on_role || p.role === f.on_role)
        .filter((p) => !f.on_prod || p.apps.includes(f.on_prod))
        .filter((p) => textMatch(f.on_q, p.name, p.languages.join(' ')))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    [people, f],
  );

  if (backend !== 'server') return null;
  const onlineCount = (people ?? []).filter((p) => p.online).length;

  async function signOut(p: PresenceRow) {
    try {
      await notesCall('POST', `/api/people/${encodeURIComponent(p.id)}/signout`, {});
      toast(`${p.name} was signed out`);
      setConfirming(null);
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not sign them out.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed in now{people ? ` · ${onlineCount}` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="stack" style={{ gap: 12 }}>
        <FilterBar active={active} onReset={reset} shown={rows.length} total={people?.length} noun="people">
          <SearchFilter value={f.on_q} onChange={(v) => set('on_q', v)} placeholder="Name or language" label="Find a person" />
          <ChipFilter label="Status" value={f.on_state} onChange={(v) => set('on_state', v)} options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }, { value: 'all', label: 'Everyone' }]} />
          <SelectFilter label="Role" value={f.on_role} onChange={(v) => set('on_role', v)} options={[{ value: 'agent', label: 'Agents' }, { value: 'supervisor', label: 'Supervisors' }, { value: 'admin', label: 'Admins' }]} />
          <SelectFilter label="Product" value={f.on_prod} onChange={(v) => set('on_prod', v)} options={APPS.map((a) => ({ value: a.id, label: a.name }))} />
        </FilterBar>
        {loadError && <p className="muted" role="alert">{loadError}</p>}
        {people && rows.length === 0 ? (
          <Empty title={f.on_state === 'online' && !active ? 'Nobody is signed in' : 'Nobody matches'}>{active ? 'Try clearing a filter.' : 'People show here while their browser is open.'}</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow data-head>
                <TableHead>Person</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Languages</TableHead>
                <TableHead className="text-right">Customers held</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead><span className="sr-only">Sign out</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {p.role === 'agent' ? <Link to={`/agents/${encodeURIComponent(p.id)}`} className="font-medium text-primary">{p.name}</Link> : <span className="font-medium">{p.name}</span>}{' '}
                    <Badge tone={p.online ? 'ok' : 'neutral'} dot>{p.online ? 'Online' : 'Offline'}</Badge>{p.call && <>{' '}<Badge tone="accent" dot>On a call</Badge></>}
                    <div className="muted" style={{ fontSize: 12.5 }}>{p.role}{p.status === 'suspended' ? ' · suspended' : ''}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.apps.map((a) => APPS.find((x) => x.id === a)?.name ?? a).join(', ') || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{p.languages.join(', ') || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.role === 'agent' ? held.get(p.id) ?? 0 : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{ago(p.lastSeen, now)}</TableCell>
                  <TableCell className="text-right">
                    {p.canSignOut && p.sessions > 0 &&
                      (confirming === p.id ? (
                        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="danger" onClick={() => void signOut(p)}>Sign out {p.name.split(' ')[0]}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                        </span>
                      ) : (
                        <Button size="sm" onClick={() => setConfirming(p.id)}>Sign out</Button>
                      ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
