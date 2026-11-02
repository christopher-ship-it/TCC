// The super admin's API page: for the product chosen in the header, what TCC asks its API, what it does with the answers,
// the limits on both sides, and how it has been going. Only the super admin can open it.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { APPS } from '../../data/seed';
import { CALL_FACTS, FIELD_MAP, KNOWN_GAPS, OTHER_SERVICES, PRODUCT_ENDPOINTS } from '../../data/apiDocs';
import { notesCall } from '../../lib/notes';
import { fmtDayTime } from '../../lib/dates';
import { Badge, Button, Callout, PageHead, Segmented } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

interface Stat { service: string; method: string; endpoint: string; count: number; errors: number; avgMs: number; maxMs: number; lastStatus: number; lastTs: number; lastOkTs: number | null; lastError: string | null }
interface Recent { ts: number; method: string; endpoint: string; status: number; ms: number; error?: string }
interface Info {
  app: string;
  configured: boolean;
  source: { host: string; path: string; running: boolean; lastFullAt: number | null; last: { fetched: number; created: number; updated: number; unchanged: number; ms: number; startedAt: number; full: boolean; error?: string } | null; failing: { count: number; nextTry: number; message: string } | null } | null;
  everyMinutes: number | null;
  callRules: { minGapMs: number; timeoutSec: number; pageSize: number; retryOn429: string; backoff: string } | null;
  calls: Stat[];
  recent: Recent[];
  limits: { id: string; label: string; methods: string[]; path: string; limit: number; windowMs: number; per: string }[];
  envNames: { url: string; key: string };
}

const ago = (ts: number | null) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} d ago`;
};
const per = (ms: number) => (ms >= 3_600_000 ? `${ms / 3_600_000} h` : `${ms / 60_000} min`);
const tone = (status: number) => (status >= 200 && status < 400 ? 'ok' : status === 0 ? 'neutral' : 'danger');

export default function ApiDocs() {
  const { backend } = useStore();
  const { apps, app: picked } = useScope();
  const toast = useToast();
  const choices = APPS.filter((a) => apps.includes(a.id));
  const [app, setApp] = useState<string>(picked !== 'all' ? picked : choices[0]?.id ?? 'irondrobe');
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Follows the product picker in the header.
  useEffect(() => {
    if (picked !== 'all') setApp(picked);
  }, [picked]);

  const load = useCallback(async () => {
    try {
      setInfo(await notesCall<Info>('GET', `/api/system/api?app=${encodeURIComponent(app)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    }
  }, [app]);
  useEffect(() => {
    if (backend !== 'server') return;
    setInfo(null);
    void load();
    const id = setInterval(() => document.visibilityState === 'visible' && void load(), 15_000);
    return () => clearInterval(id);
  }, [backend, load]);

  async function test() {
    setTesting(true);
    try {
      const r = await notesCall<{ ok: boolean; message: string; ms: number }>('POST', '/api/system/api/ping', { app });
      toast(r.ok ? `${r.message} (${r.ms} ms)` : r.message);
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The test failed.');
    } finally {
      setTesting(false);
    }
  }

  const name = APPS.find((a) => a.id === app)?.name ?? app;
  const statFor = (key: string, method: string) => info?.calls.find((c) => c.endpoint === key && c.method === method);
  const gaps = KNOWN_GAPS[app];
  const src = info?.source;
  const base = src ? `https://${src.host}${src.path}` : null;

  return (
    <div className="page">
      <PageHead
        title="API"
        desc={`What TCC asks ${name}’s API, what it does with the answers, and how it is going. Only the super admin sees this.`}
        actions={choices.length > 1 ? <Segmented label="Product" value={app} onChange={setApp} options={choices.map((a) => ({ value: a.id, label: a.name }))} /> : undefined}
      />

      {backend !== 'server' && <Callout tone="warn">This build has no server, so there are no live numbers. The documentation below is still accurate.</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}

      <Card>
        <CardHeader><CardTitle>Connection · {name}</CardTitle></CardHeader>
        <CardContent className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {info ? <Badge tone={!info.configured ? 'warn' : src?.failing ? 'danger' : 'ok'} dot>{!info.configured ? 'Not connected' : src?.failing ? `Failing (${src.failing.count} runs in a row)` : 'Connected'}</Badge> : <span className="muted">{backend === 'server' ? 'Loading…' : 'Live status needs the server'}</span>}
            {base && <code>{base}</code>}
            <span style={{ marginLeft: 'auto' }} className="row">
              {info?.configured && <Button size="sm" onClick={() => void test()} disabled={testing}>{testing ? 'Testing…' : 'Test now'}</Button>}
              <Link to="/system" className="btn btn--sm">Sync now (System)</Link>
            </span>
          </div>
          {info && !info.configured && (
            <Callout tone="warn">
              {name} is not connected. Set <code>{info.envNames.url}</code> and <code>{info.envNames.key}</code> on the server (the address and the key the product gives TCC), and it starts syncing within minutes. The key is only ever kept on the server.
            </Callout>
          )}
          {src?.failing && <Callout tone="danger">{src.failing.message}<br /><span className="muted">TCC will try again {src.failing.nextTry > Date.now() ? `in about ${Math.max(1, Math.round((src.failing.nextTry - Date.now()) / 60_000))} min` : 'on the next run'}. Customers already in TCC are untouched.</span></Callout>}
          {src && (
            <dl className="kv-list" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 18px', margin: 0 }}>
              <dt className="muted">Change check</dt><dd>every {info?.everyMinutes} minutes, plus a full refresh once a day</dd>
              <dt className="muted">Last run</dt><dd>{src.last ? `${ago(src.last.startedAt)} · ${src.last.full ? 'everyone' : 'changes'} · ${src.last.fetched} fetched, ${src.last.created} new, ${src.last.updated} updated · ${(src.last.ms / 1000).toFixed(1)} s${src.last.error ? ' · failed' : ''}` : 'Not yet'}</dd>
              <dt className="muted">Last full refresh</dt><dd>{src.lastFullAt ? fmtDayTime(src.lastFullAt) : 'Never'}</dd>
              <dt className="muted">Key</dt><dd>Set on the server as <code>{info?.envNames.key}</code> (never shown)</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Endpoints TCC calls on {name}</CardTitle></CardHeader>
        <CardContent className="stack" style={{ gap: 18 }}>
          {PRODUCT_ENDPOINTS.map((e) => {
            const s = statFor(e.key, e.method);
            return (
              <section key={e.method + e.path} className="stack" style={{ gap: 6 }} aria-label={`${e.method} ${e.path}`}>
                <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Badge tone={e.method === 'GET' ? 'accent' : 'warn'}>{e.method}</Badge>
                  <code style={{ fontSize: 14 }}>{src?.path ?? '/api/tcc/v1/'}{e.path}</code>
                  {s ? (
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
                      {s.count} call{s.count === 1 ? '' : 's'} since start · {s.errors} failed · avg {s.avgMs} ms · last <Badge tone={tone(s.lastStatus)}>{s.lastStatus || 'no answer'}</Badge> {ago(s.lastTs)}
                    </span>
                  ) : info?.configured ? <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>Not called since the server started</span> : null}
                </div>
                <p style={{ margin: 0 }}>{e.purpose}</p>
                <p className="muted" style={{ margin: 0, fontSize: 13.5 }}><b style={{ fontWeight: 500 }}>When:</b> {e.when}</p>
                {e.params && (
                  <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                    {e.params.map((p) => <li key={p.name}><code>{p.name}</code> = {p.value}. {p.note}</li>)}
                  </ul>
                )}
                <p className="muted" style={{ margin: 0, fontSize: 13.5 }}><b style={{ fontWeight: 500 }}>TCC uses:</b> {e.uses.join(' · ')}</p>
                {s?.lastError && s.lastStatus >= 400 && <p style={{ margin: 0, color: 'var(--danger)', fontSize: 13.5 }}>Last error: {s.lastError}</p>}
              </section>
            );
          })}
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
            {CALL_FACTS.map(([k, v]) => <li key={k}><b style={{ fontWeight: 500 }}>{k}:</b> {v}</li>)}
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Limits on TCC’s calls to {name}</CardTitle></CardHeader>
          <CardContent>
            {info?.callRules ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                <li>At most one call every {info.callRules.minGapMs} ms to one product ({Math.round(1000 / info.callRules.minGapMs)} a second), so a catch-up never floods it.</li>
                <li>{info.callRules.pageSize} customers a page; each call times out after {info.callRules.timeoutSec} s.</li>
                <li>If the product answers 429 (too many requests), TCC waits {info.callRules.retryOn429}.</li>
                <li>After a failed run: {info.callRules.backoff}. One line in Events for the first two failures, then one every sixth.</li>
                <li>The product’s own limit, per its guide, is 120 requests a minute per key; a sync uses a few a minute at most.</li>
              </ul>
            ) : <span className="muted">Shown once a product is connected.</span>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Limits on TCC’s own API (what is allowed in)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow data-head><TableHead>What</TableHead><TableHead className="text-right">Allowed</TableHead><TableHead>Counted per</TableHead></TableRow></TableHeader>
              <TableBody>
                {(info?.limits ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.label}<div className="muted mono" style={{ fontSize: 11.5 }}>{l.methods.join('/')} {l.path}</div></TableCell>
                    <TableCell className="text-right tabular-nums">{l.limit} / {per(l.windowMs)}</TableCell>
                    <TableCell className="text-muted-foreground">{l.per === 'person' ? 'person' : 'address'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Going over answers “429 Too many requests” with how long to wait. A save that is slowed down is kept and retried, never lost.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent calls to {name}</CardTitle></CardHeader>
        <CardContent>
          {info && info.recent.length === 0 ? <p className="muted">None since the server started.</p> : (
            <Table>
              <TableHeader><TableRow data-head><TableHead>When</TableHead><TableHead>Call</TableHead><TableHead>Answer</TableHead><TableHead className="text-right">Time</TableHead><TableHead>Problem</TableHead></TableRow></TableHeader>
              <TableBody>
                {(info?.recent ?? []).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="mono text-muted-foreground" style={{ fontSize: 12 }}>{fmtDayTime(r.ts)}</TableCell>
                    <TableCell><code>{r.method} {r.endpoint}</code></TableCell>
                    <TableCell><Badge tone={tone(r.status)}>{r.status || 'no answer'}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{r.ms} ms</TableCell>
                    <TableCell className="text-muted-foreground" style={{ whiteSpace: 'normal', maxWidth: 420 }}>{r.error ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>The newest 50, kept in memory since the last restart. Keys, headers and customer details are never recorded here.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>What each field becomes in TCC</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow data-head><TableHead>{name} sends</TableHead><TableHead>TCC shows</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
            <TableBody>
              {FIELD_MAP.map((f) => (
                <TableRow key={f.from}>
                  <TableCell><code>{f.from}</code></TableCell>
                  <TableCell>{f.to}</TableCell>
                  <TableCell className="text-muted-foreground" style={{ whiteSpace: 'normal' }}>{f.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {gaps && (
        <Callout tone="warn">
          <b>Known gaps for {name}</b> (checked {gaps.checked})
          <ul style={{ margin: '6px 0 0 18px', listStyle: 'disc' }}>{gaps.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Callout>
      )}

      <Card>
        <CardHeader><CardTitle>Other services TCC calls (the same for every product)</CardTitle></CardHeader>
        <CardContent className="stack" style={{ gap: 14 }}>
          {OTHER_SERVICES.map((s) => (
            <section key={s.name}>
              <b style={{ fontWeight: 500 }}>{s.name}</b> <span className="muted mono" style={{ fontSize: 12.5 }}>{s.host}</span>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13.5 }}>{s.calls.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{s.limits}</p>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
