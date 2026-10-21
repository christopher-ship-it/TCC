// The super admin's console: is everything healthy, who is signed in, what went wrong and where, and the tools
// to fix an account (new password, ask them to change it, sign them out, change how they sign in).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, KeyRound, LogOut, Mail, RefreshCw, Send, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '../../store/StoreContext';
import type { AuditEntry } from '../../data/types';
import type { AgentAccount } from '../../data/types';
import { ROLE_INFO } from '../../lib/access';
import { fmtDayTime } from '../../lib/dates';
import { Button, Callout, Chip, Field, Input, PageHead, Tabs, Toggle } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

interface Ev { ts: number; level: 'info' | 'warn' | 'error'; source: string; message: string; agentName?: string; detail?: unknown }
interface Req { ts: number; method: string; path: string; status: number; ms: number; agentName?: string }
interface Endpoint { endpoint: string; count: number; errors: number; totalMs: number; maxMs: number; lastStatus: number; lastTs: number }
interface Person extends AgentAccount { lastSeen: number | null; sessions: number; lastSignIn: number | null; hasLogin: boolean; openNotices: number }
interface SystemData {
  health: {
    startedAt: number;
    uptimeSec: number;
    node: string;
    commit: string | null;
    memoryMb: number;
    database: { ok: boolean; error?: string; latencyMs?: number; schemaVersion?: number; tables?: Record<string, number> };
    gemini: { configured: boolean; model: string; queue: { running: number; waiting: number; max: number } };
    telecmi: { configured: boolean; appId: string | null };
    setupFormOpen: boolean;
    endpoints: Endpoint[];
    requests: Req[];
    events: Ev[];
  };
  people: Person[];
  visibility: { changeLog: boolean };
  passwordRequests: { id: string; title: string; body: string; fromName: string; subjectId: string; subjectName: string; ts: number }[];
  activity: AuditEntry[];
  totals: { customers: number; calls: number; callsToday: number };
}

type Tab = 'health' | 'people' | 'activity' | 'events' | 'requests' | 'endpoints';

const ago = (ts: number | null) => {
  if (!ts) return 'Never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDayTime(ts).split(' · ')[0];
};
const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
  return j;
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return ok ? <CheckCircle2 size={18} className="text-emerald-600" /> : warn ? <AlertTriangle size={18} className="text-amber-600" /> : <XCircle size={18} className="text-red-600" />;
}

function LevelBadge({ level }: { level: Ev['level'] }) {
  const cls = level === 'error' ? 'border-red-300 text-red-700' : level === 'warn' ? 'border-amber-300 text-amber-700' : '';
  return <Badge variant="outline" className={cls}>{level}</Badge>;
}

/** Fix one account: password, a request in their inbox, sign-out, how they sign in. */
function AccountTools({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: () => void }) {
  const { setPassword, grantPasswordChange, currentAgent } = useStore();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [note, setNote] = useState('');
  const [username, setUsername] = useState(person.username);
  const [email, setEmail] = useState(person.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const self = person.id === currentAgent?.id;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(ok);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  const must = async (r: { ok: true } | { ok: false; message: string } | undefined) => {
    if (r && !r.ok) throw new Error(r.message);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{person.name}</DialogTitle>
          <DialogDescription>{ROLE_INFO[person.role].label}{person.superAdmin ? ' · Super admin' : ''} · last seen {ago(person.lastSeen)} · {person.sessions} active session{person.sessions === 1 ? '' : 's'}</DialogDescription>
        </DialogHeader>
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="stack" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 8 }}>
            <span className="section-label">Sign-in</span>
            <div className="grid-2" style={{ gap: 10 }}>
              <Field label="Username" htmlFor="st-user"><Input id="st-user" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} /></Field>
              <Field label="Login email" htmlFor="st-email" hint="They can sign in with this too."><Input id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></Field>
            </div>
            <Button icon={<Mail size={15} />} disabled={busy || (username === person.username && email === (person.email ?? ''))} onClick={() => void run(() => post('/api/system/login', { agentId: person.id, username, email }), 'Sign-in updated')}>Save sign-in</Button>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <span className="section-label">Set a new password now</span>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <Input aria-label="New password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 6 characters" autoComplete="off" />
              <Button icon={<KeyRound size={15} />} disabled={busy || pw.length < 6} onClick={() => void run(async () => must(await setPassword?.(person.id, pw)), `New password set for ${person.name}`)}>Set</Button>
            </div>
            <span className="muted" style={{ fontSize: 12.5 }}>They are signed out on other devices and must use the new one.</span>
          </div>
          {!self && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="section-label">Let them choose it themselves</span>
              <Input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
              <Button icon={<Send size={15} />} disabled={busy} onClick={() => void run(async () => must(await grantPasswordChange?.(person.id, note || undefined)), `${person.name} will see a card in their inbox`)}>Send them a card</Button>
              <span className="muted" style={{ fontSize: 12.5 }}>You never see the password they pick.</span>
            </div>
          )}
          {!self && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="section-label">Sessions</span>
              <Button variant="danger-outline" icon={<LogOut size={15} />} disabled={busy || person.sessions === 0} onClick={() => void run(() => post('/api/system/signout', { agentId: person.id }), `${person.name} signed out everywhere`)}>Sign out on every device</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function System() {
  const [data, setData] = useState<SystemData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('health');
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [checks, setChecks] = useState<Record<string, { ok: boolean; message: string; ms: number } | 'running'>>({});
  const [editing, setEditing] = useState<Person | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/system', { credentials: 'same-origin' });
      const j = (await r.json()) as SystemData & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === 'visible' && void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const runCheck = async (what: string) => {
    setChecks((c) => ({ ...c, [what]: 'running' }));
    try {
      const r = await post<{ ok: boolean; message: string; ms: number }>('/api/system/check', { what });
      setChecks((c) => ({ ...c, [what]: r }));
    } catch (e) {
      setChecks((c) => ({ ...c, [what]: { ok: false, message: e instanceof Error ? e.message : 'Failed', ms: 0 } }));
    }
  };

  const h = data?.health;
  const hourAgo = Date.now() - 3600_000;
  const recentErrors = useMemo(() => (h ? h.events.filter((e) => e.level === 'error' && e.ts > hourAgo).length : 0), [h, hourAgo]);
  const problems: string[] = [];
  if (h) {
    if (!h.database.ok) problems.push(`Database: ${h.database.error ?? 'unreachable'}`);
    if (!h.gemini.configured) problems.push('Call analysis is off: GEMINI_API_KEY is not set.');
    if (!h.telecmi.configured) problems.push('Recordings are off: TeleCMI App ID / secret are not set.');
    if (h.setupFormOpen) problems.push('The first-admin setup form is open (TCC_SETUP_CODE is set).');
    if (recentErrors) problems.push(`${recentErrors} error${recentErrors === 1 ? '' : 's'} in the last hour — see Events.`);
    if (h.gemini.queue.waiting > 3) problems.push(`${h.gemini.queue.waiting} calls waiting for analysis.`);
  }
  const online = data?.people.filter((p) => p.lastSeen && Date.now() - p.lastSeen < 3 * 60_000).length ?? 0;
  const q = search.trim().toLowerCase();
  const events = (h?.events ?? [])
    .filter((e) => level === 'all' || (level === 'warn' ? e.level !== 'info' : e.level === 'error'))
    .filter((e) => source === 'all' || e.source === source)
    .filter((e) => !q || `${e.message} ${e.agentName ?? ''}`.toLowerCase().includes(q));
  const sources = ['all', ...Array.from(new Set((h?.events ?? []).map((e) => e.source))).sort()];
  const activity = (data?.activity ?? []).filter((a) => !q || `${a.actorName} ${a.action} ${a.target ?? ''} ${a.detail}`.toLowerCase().includes(q));
  const { grantPasswordChange } = useStore();
  const toast = useToast();
  const requests = data?.passwordRequests ?? [];

  const checkRow = (what: string, label: string) => {
    const c = checks[what];
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{c && c !== 'running' ? <span className={c.ok ? 'text-emerald-700' : 'text-red-700'}>{c.message}{c.ms ? ` · ${c.ms} ms` : ''}</span> : <span className="muted">{label}</span>}</span>
        <Button size="sm" icon={<RefreshCw size={14} />} disabled={c === 'running'} onClick={() => void runCheck(what)}>{c === 'running' ? 'Testing…' : 'Test now'}</Button>
      </div>
    );
  };

  return (
    <div className="page">
      <PageHead
        title="System"
        desc="Super admin: health, who is signed in, every event and request, and account repairs. Refreshes every 10 seconds."
        actions={<Button icon={<RefreshCw size={15} />} onClick={() => void load()}>Refresh</Button>}
      />
      {error && <Callout tone="danger">{error}</Callout>}
      {!data ? (
        !error && <span className="muted">Loading…</span>
      ) : (
        <>
          {problems.length === 0 ? (
            <Callout tone="ok" icon={<CheckCircle2 size={16} />}>All systems working. {online} {online === 1 ? 'person' : 'people'} online now.</Callout>
          ) : (
            <Callout tone="warn" icon={<AlertTriangle size={16} />}>
              <b>Needs attention</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </Callout>
          )}

          {requests.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound size={17} />Password requests ({requests.length})</CardTitle></CardHeader>
              <CardContent className="stack" style={{ gap: 10 }}>
                {requests.map((r) => {
                  const person = data.people.find((p) => p.id === r.subjectId);
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span style={{ minWidth: 0 }}>
                        <b>{r.subjectName}</b> <span className="muted">· asked by {r.fromName} · {ago(r.ts)}</span>
                        {r.body && !r.body.includes('asked for a new password') && <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{r.body}</span>}
                      </span>
                      <span className="row" style={{ gap: 8 }}>
                        <Button size="sm" onClick={() => void grantPasswordChange?.(r.subjectId).then((x) => { toast(x.ok ? `${r.subjectName} will see a card to choose a new password` : x.message); void load(); })}>Let them choose</Button>
                        {person && <Button size="sm" variant="primary" onClick={() => setEditing(person)}>Set a password</Button>}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Tabs
            label="System sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'health', label: 'Health' },
              { value: 'people', label: 'People', count: data.people.length },
              { value: 'activity', label: 'Activity', count: data.activity.length },
              { value: 'events', label: 'Events', count: recentErrors || undefined },
              { value: 'requests', label: 'Requests' },
              { value: 'endpoints', label: 'Endpoints' },
            ]}
          />

          {tab === 'health' && h && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>What client admins and agents can see</CardTitle></CardHeader>
                <CardContent className="stack" style={{ gap: 10 }}>
                  <Toggle
                    checked={data.visibility.changeLog}
                    onChange={(v) => void post('/api/system/visibility', { changeLog: v }).then(() => { toast(v ? 'Change log is on for client admins' : 'Change log is off for client admins'); void load(); }).catch((e: Error) => toast(e.message))}
                    label="Change log"
                    help="Their own “who did what” page: sign-ins, people added, access changes. Turn it off and they don’t see the page at all."
                  />
                  <p className="muted" style={{ fontSize: 12.5 }}>Always hidden from them, whatever you choose: this System page, your account, and everything you or Tecstellar’s tools do. You see all of it under Activity and Events.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Dot ok />Server</CardTitle></CardHeader>
                <CardContent className="stack" style={{ gap: 6 }}>
                  <div className="kv"><span>Up for</span><span>{uptime(h.uptimeSec)}</span></div>
                  <div className="kv"><span>Version</span><span className="mono">{h.commit ?? 'local'}</span></div>
                  <div className="kv"><span>Memory</span><span>{h.memoryMb} MB</span></div>
                  <div className="kv"><span>Node</span><span className="mono">{h.node}</span></div>
                  <div className="kv"><span>Customers · calls · today</span><span className="mono">{data.totals.customers} · {data.totals.calls} · {data.totals.callsToday}</span></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Dot ok={h.database.ok} />Database</CardTitle></CardHeader>
                <CardContent className="stack" style={{ gap: 6 }}>
                  {h.database.ok ? (
                    <>
                      <div className="kv"><span>Response</span><span>{h.database.latencyMs} ms</span></div>
                      <div className="kv"><span>Schema</span><span>v{h.database.schemaVersion}</span></div>
                      <div className="kv"><span>Rows</span><span className="mono" style={{ fontSize: 12 }}>{Object.entries(h.database.tables ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</span></div>
                    </>
                  ) : <Callout tone="danger">{h.database.error}</Callout>}
                  {checkRow('database', 'Connect and query')}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Dot ok={h.gemini.configured} />Call analysis (Gemini)</CardTitle></CardHeader>
                <CardContent className="stack" style={{ gap: 6 }}>
                  <div className="kv"><span>Model</span><span className="mono">{h.gemini.model}</span></div>
                  <div className="kv"><span>Analysing now</span><span>{h.gemini.queue.running} of {h.gemini.queue.max} · {h.gemini.queue.waiting} waiting</span></div>
                  {checkRow('gemini', 'Check the API key works')}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Dot ok={h.telecmi.configured} />Phone line (TeleCMI)</CardTitle></CardHeader>
                <CardContent className="stack" style={{ gap: 6 }}>
                  <div className="kv"><span>App ID</span><span className="mono">{h.telecmi.appId ?? '—'}</span></div>
                  <div className="kv"><span>People with a line</span><span>{data.people.filter((p) => p.telecmiUserId).length} of {data.people.filter((p) => p.role === 'agent').length} agents</span></div>
                  {checkRow('telecmi', 'Check the App ID and secret')}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'people' && (
            <Card>
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-base font-semibold">Everyone, including admins</span>
                <Link to="/people?edit=new" className="btn btn--sm">Add a person</Link>
              </div>
              <Table>
                <TableHeader>
                  <TableRow data-head>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead>Phone line</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.people.map((p) => {
                    const on = p.lastSeen && Date.now() - p.lastSeen < 3 * 60_000;
                    return (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => setEditing(p)}>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          <div className="mono muted" style={{ fontSize: 12 }}>{p.username}{p.email ? ` · ${p.email}` : ''}</div>
                        </TableCell>
                        <TableCell>{p.superAdmin ? 'Super admin' : ROLE_INFO[p.role].label}</TableCell>
                        <TableCell>
                          {(p.status ?? 'active') === 'active' ? <Badge variant="outline">Active</Badge> : <Badge variant="outline" className="border-red-300 text-red-700">{p.status}</Badge>}
                          {!p.hasLogin && <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">No password</Badge>}
                          {p.openNotices > 0 && <Badge variant="outline" className="ml-1">Asked to change password</Badge>}
                        </TableCell>
                        <TableCell>{on ? <span className="text-emerald-700">● Online</span> : ago(p.lastSeen)}</TableCell>
                        <TableCell className="text-muted-foreground">{ago(p.lastSignIn)}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.sessions}</TableCell>
                        <TableCell className="mono text-muted-foreground" style={{ fontSize: 12 }}>{p.telecmiUserId ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="muted px-4 py-3" style={{ fontSize: 12.5 }}>Click a person to reset their password, ask them to change it, sign them out or change how they sign in. Access (products, languages, queues) is edited under <Link to="/people">Agents</Link>; every change is in the <Link to="/audit">Change log</Link>.</p>
            </Card>
          )}

          {tab === 'activity' && (
            <Card>
              <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                <span className="mr-auto text-base font-semibold">Everything people did, newest first</span>
                <Input aria-label="Search activity" placeholder="Search person or action" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
              </div>
              {activity.length === 0 ? <p className="muted px-4 pb-4">Nothing here.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow data-head>
                      <TableHead style={{ width: 150 }}>When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>About</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activity.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="mono text-muted-foreground" style={{ fontSize: 12 }}>{fmtDayTime(a.ts)}</TableCell>
                        <TableCell className="font-medium">{a.actorName}</TableCell>
                        <TableCell style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{a.detail}</TableCell>
                        <TableCell className="text-muted-foreground">{a.target ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}

          {tab === 'events' && (
            <Card>
              <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
                <span className="mr-auto text-base font-semibold">Events</span>
                <Input aria-label="Search events" placeholder="Search text or person" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220 }} />
                <select aria-label="Where" className="h-8 rounded-md border border-input bg-card px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value)}>
                  {sources.map((s) => <option key={s} value={s}>{s === 'all' ? 'All sources' : s}</option>)}
                </select>
                {(['all', 'warn', 'error'] as const).map((l) => <Chip key={l} pressed={level === l} onClick={() => setLevel(l)}>{l === 'all' ? 'Everything' : l === 'warn' ? 'Warnings & errors' : 'Errors'}</Chip>)}
              </div>
              {events.length === 0 ? <p className="muted px-4 pb-4">Nothing here.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow data-head>
                      <TableHead style={{ width: 150 }}>When</TableHead>
                      <TableHead style={{ width: 80 }}>Level</TableHead>
                      <TableHead style={{ width: 90 }}>Where</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>Who</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e, i) => (
                      <TableRow key={`${e.ts}-${i}`}>
                        <TableCell className="mono text-muted-foreground" style={{ fontSize: 12 }}>{fmtDayTime(e.ts)}</TableCell>
                        <TableCell><LevelBadge level={e.level} /></TableCell>
                        <TableCell className="text-muted-foreground">{e.source}</TableCell>
                        <TableCell style={{ whiteSpace: 'normal', wordBreak: 'break-word' }} title={e.detail ? JSON.stringify(e.detail) : undefined}>{e.message}</TableCell>
                        <TableCell className="text-muted-foreground">{e.agentName ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}

          {tab === 'requests' && h && (
            <Card>
              <div className="px-4 pt-3 pb-2 text-base font-semibold">Last {h.requests.length} requests since the server started</div>
              <Table>
                <TableHeader>
                  <TableRow data-head>
                    <TableHead style={{ width: 150 }}>When</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                    <TableHead>Who</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {h.requests.slice(0, 300).map((r, i) => (
                    <TableRow key={`${r.ts}-${i}`}>
                      <TableCell className="mono text-muted-foreground" style={{ fontSize: 12 }}>{fmtDayTime(r.ts)}</TableCell>
                      <TableCell className="mono" style={{ fontSize: 12.5 }}>{r.method} {r.path}</TableCell>
                      <TableCell className={`text-right mono ${r.status >= 500 ? 'text-red-700' : r.status >= 400 ? 'text-amber-700' : ''}`}>{r.status}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.ms} ms</TableCell>
                      <TableCell className="text-muted-foreground">{r.agentName ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {tab === 'endpoints' && h && (
            <Card>
              <div className="px-4 pt-3 pb-2 text-base font-semibold">Endpoints since the server started ({uptime(h.uptimeSec)} ago)</div>
              <Table>
                <TableHeader>
                  <TableRow data-head>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Slowest</TableHead>
                    <TableHead>Last</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {h.endpoints.map((e) => (
                    <TableRow key={e.endpoint}>
                      <TableCell className="mono" style={{ fontSize: 12.5 }}>{e.endpoint}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.count}</TableCell>
                      <TableCell className={`text-right tabular-nums ${e.errors ? 'text-amber-700' : ''}`}>{e.errors}</TableCell>
                      <TableCell className="text-right tabular-nums">{Math.round(e.totalMs / e.count)} ms</TableCell>
                      <TableCell className="text-right tabular-nums">{e.maxMs} ms</TableCell>
                      <TableCell className="text-muted-foreground">{e.lastStatus} · {ago(e.lastTs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
      {editing && <AccountTools person={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />}
    </div>
  );
}
