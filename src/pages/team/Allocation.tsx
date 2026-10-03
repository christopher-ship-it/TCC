import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Shuffle } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { STATE_DEFS } from '../../data/seed';
import { isActive, LANGUAGE_SCRIPT } from '../../lib/access';
import { isReachable, reachableCount } from '../../lib/queue';
import { Avatar, Badge, Button, Callout, Card, PageHead, Stat } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

/** Who covers which customers: every waiting customer should have at least one agent who speaks their language in their state. */
export default function Allocation() {
  const { state, dispatch, currentAgent } = useStore();
  const { apps } = useScope();
  const toast = useToast();
  const agents = state.agents.filter((a) => a.role === 'agent' && isActive(a) && a.apps.some((x) => apps.includes(x)));
  const waiting = useMemo(() => state.users.filter((u) => u.queue && apps.includes(u.app)), [state.users, apps]);

  const rows = useMemo(
    () =>
      STATE_DEFS.map((s) => {
        const here = waiting.filter((u) => u.effectiveState === s.name);
        const coveredBy = agents.filter((a) => here.some((u) => a.queues.includes(u.queue!) && isReachable(a, u)));
        const uncovered = here.filter((u) => !agents.some((a) => a.queues.includes(u.queue!) && isReachable(a, u))).length;
        return { s, waiting: here.length, coveredBy, uncovered };
      }).filter((r) => r.waiting > 0),
    [waiting, agents],
  );
  const uncovered = rows.reduce((n, r) => n + r.uncovered, 0);
  const unowned = waiting.filter((u) => !u.ownerAgentId).length;

  return (
    <div className="page">
      <PageHead
        title="Allocation"
        desc="Customers are served to agents who work their queue, speak their language and hold their state. This shows where nobody does."
        actions={
          <Button
            variant="primary"
            icon={<Shuffle size={15} />}
            disabled={!unowned}
            onClick={() => {
              dispatch({ type: 'AUTO_DISTRIBUTE', actorId: currentAgent!.id });
              toast('Unowned customers handed to matching agents');
            }}
          >
            Give unowned customers an owner
          </Button>
        }
      />
      <div className="stats">
        <Stat label="Customers waiting" value={waiting.length.toLocaleString('en-IN')} />
        <Stat label="Nobody can reach" value={uncovered} tone={uncovered ? 'danger' : 'ok'} note={uncovered ? 'Need a language or state added' : 'Everyone is covered'} />
        <Stat label="Without an owner" value={unowned} note="The queue serves them to whoever is free" />
        <Stat label="Active agents" value={agents.length} />
      </div>
      {uncovered > 0 && <Callout tone="warn">{uncovered} waiting customers have no agent with the right language, state and queue. Add reach to someone on the People page.</Callout>}

      <div className="grid-2">
        <Card title="Coverage by state" pad={false}>
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl">
              <thead><tr><th>State</th><th className="r">Waiting</th><th>Covered by</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.s.name}>
                    <td>
                      <b style={{ fontWeight: 500 }}>{r.s.name}</b>
                      <div className="muted" style={{ fontSize: 12.5 }}>{LANGUAGE_SCRIPT[r.s.language]} · {r.s.language}</div>
                    </td>
                    <td className="r mono">{r.waiting}</td>
                    <td>
                      {r.coveredBy.length ? <span>{r.coveredBy.map((a) => a.name).join(', ')}</span> : <Badge tone="danger">Nobody</Badge>}
                      {r.uncovered > 0 && r.coveredBy.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{r.uncovered} not reachable</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Agents’ reach" pad={false} actions={<Link to="/people" className="btn btn--sm">Change reach</Link>}>
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl">
              <thead><tr><th>Agent</th><th>Speaks</th><th className="r">States</th><th className="r">Can reach</th></tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Avatar name={a.name} />{a.name}</span></td>
                    <td>{a.languages.map((l) => LANGUAGE_SCRIPT[l]).join(' · ')}</td>
                    <td className="r mono">{a.states.length}</td>
                    <td className="r mono">{reachableCount(a, waiting).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
