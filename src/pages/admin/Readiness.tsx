import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import { TELEPHONY_MODE, TEST_NUMBER, LIVE_DIAL } from '../../lib/telephony';
import { runChecks, type CheckStatus, type ServerReport } from '../../lib/readiness';
import { countByOrigin, isDemoAgent, originOf } from '../../lib/world';
import { Badge, Callout, Card, PageHead, Stat } from '../../ui/primitives';

const ICON: Record<CheckStatus, ReactNode> = {
  pass: <CheckCircle2 size={18} color="var(--ok)" aria-label="OK" />,
  warn: <AlertTriangle size={18} color="var(--warn)" aria-label="Needs attention" />,
  fail: <XCircle size={18} color="var(--danger)" aria-label="Blocks real clients" />,
};

const appName = (id: string) => APPS.find((a) => a.id === id)?.name ?? id;

/** Asks the TCC server what it has switched on. null when it cannot be reached (e.g. a static host). */
function useServerReport(): ServerReport | null | undefined {
  const [report, setReport] = useState<ServerReport | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { analysis?: boolean; recordings?: boolean } | null) => live && setReport(j ? { analysis: !!j.analysis, recordings: !!j.recordings } : null))
      .catch(() => live && setReport(null));
    return () => {
      live = false;
    };
  }, []);
  return report;
}

/** One place to see whether it is safe to let real clients on: what is real, what is demo, and what is still switched off. */
export default function Readiness() {
  const { state, backend } = useStore();
  const server = useServerReport();

  const result = useMemo(
    () => runChecks({ backend, users: state.allUsers, agents: state.allAgents, telephony: { provider: TELEPHONY_MODE === 'telecmi' || TELEPHONY_MODE === 'mock' ? TELEPHONY_MODE : null, testNumber: TEST_NUMBER, live: LIVE_DIAL }, server: server ?? null, appName }),
    [backend, state.allUsers, state.allAgents, server],
  );
  const byApp = useMemo(() => countByOrigin(state.allUsers), [state.allUsers]);
  const rows = Object.entries(byApp);
  const total = rows.reduce((t, [, c]) => ({ app: t.app + c.app, tcc: t.tcc + c.tcc, sample: t.sample + c.sample }), { app: 0, tcc: 0, sample: 0 });
  const demoPeople = state.allAgents.filter(isDemoAgent).length;
  const realCalls = state.allUsers.filter((u) => originOf(u) !== 'sample').reduce((n, u) => n + u.callHistory.length, 0);

  const verdict =
    result.verdict === 'ready'
      ? { tone: 'ok' as const, text: 'Ready for real clients.' }
      : result.verdict === 'caution'
        ? { tone: 'warn' as const, text: `Safe to test. ${result.warned} thing${result.warned === 1 ? '' : 's'} to tidy before going fully live.` }
        : { tone: 'danger' as const, text: `Not ready for real clients: ${result.failed} thing${result.failed === 1 ? '' : 's'} to fix first.` };

  return (
    <div className="page">
      <PageHead title="Go-live check" desc="What is real, what is demo, and whether calling is switched on safely. Checked live against this deployment." />
      <Callout tone={verdict.tone}>{verdict.text}</Callout>

      <div className="stats">
        <Stat label="Real customers" value={total.app.toLocaleString('en-IN')} note="From the apps, via import" tone={total.app ? 'ok' : 'danger'} />
        <Stat label="Created in TCC" value={total.tcc.toLocaleString('en-IN')} note="Numbers dialled by real agents" />
        <Stat label="Demo customers" value={total.sample.toLocaleString('en-IN')} note="Generated. Demo accounts only" />
        <Stat label="Calls on real customers" value={realCalls.toLocaleString('en-IN')} note={`${demoPeople} demo account${demoPeople === 1 ? '' : 's'}`} />
      </div>

      <Card title="Checks">
        <ul className="stack" style={{ gap: 14, listStyle: 'none', margin: 0, padding: 0 }}>
          {result.checks.map((c) => (
            <li key={c.id} className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <span style={{ flex: 'none', marginTop: 1 }}>{ICON[c.status]}</span>
              <span style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 600 }}>{c.title}</b>
                <span style={{ display: 'block', color: 'var(--ink-2)' }}>{c.detail}</span>
                {c.status !== 'pass' && c.fix && (
                  <span style={{ display: 'block', fontSize: 13 }} className="muted">
                    {c.fix} {c.to && <Link to={c.to}>Open</Link>}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {server === undefined && <span className="muted" style={{ fontSize: 13 }}>Checking the server…</span>}
      </Card>

      <Card title="Where the customer data comes from" sub="Every customer record is stamped when it is made, so real and demo data can never be confused.">
        <div className="tbl-wrap" style={{ border: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>App</th>
                <th className="r">From the app <Badge tone="ok">real</Badge></th>
                <th className="r">Created in TCC <Badge tone="accent">real</Badge></th>
                <th className="r">Demo data <Badge tone="warn">demo</Badge></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([app, c]) => (
                <tr key={app}>
                  <td>{appName(app)}</td>
                  <td className="r mono">{c.app.toLocaleString('en-IN')}</td>
                  <td className="r mono">{c.tcc.toLocaleString('en-IN')}</td>
                  <td className="r mono">{c.sample.toLocaleString('en-IN')}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="muted">No customers at all yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
          “From the app” is what was imported from the product’s own data (a CSV export today). “Created in TCC” is a number an agent dialled that is not a customer yet.
          Call logs, tickets, follow-ups and owners are always written by TCC, on top of either.
        </p>
      </Card>
    </div>
  );
}
