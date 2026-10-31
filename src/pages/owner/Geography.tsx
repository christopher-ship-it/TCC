// Where customers are: India coloured state by state (or by the language each state speaks), with the numbers beside it.
// Follows the product picker in the header and the filters above.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { APPS as APPS_LIST } from '../../data/seed';
import type { Language } from '../../data/types';
import { inrLabel } from '../../lib/dates';
import { isActive } from '../../lib/access';
import { CUSTOMER_LANGUAGES, languageForState } from '../../lib/languages';
import { LANGUAGE_COLOR, dominantLanguage, stateStats } from '../../lib/geo';
import IndiaMap, { type MapMode } from '../../components/owner/IndiaMap';
import { BarList } from '../../ui/charts';
import { FilterBar, SelectFilter, useFilters } from '../../ui/filters';
import { Badge, Callout, Card, PageHead, Segmented, Stat } from '../../ui/primitives';
import '../customer.css';

const nf = (n: number) => n.toLocaleString('en-IN');

export default function Geography() {
  const { state } = useStore();
  const { apps } = useScope();
  const [mode, setMode] = useState<MapMode>('customers');
  const [picked, setPicked] = useState<string | null>(null);
  const { values: f, set, reset, active } = useFilters(['glang', 'gprod', 'gplan', 'gactive'] as const);

  const inScope = useMemo(() => state.users.filter((u) => apps.includes(u.app) && !u.deleted), [state.users, apps]);
  const users = useMemo(
    () =>
      inScope
        .filter((u) => !f.gprod || u.app === f.gprod)
        .filter((u) => !f.glang || u.language === f.glang)
        .filter((u) => !f.gplan || (f.gplan === 'paying') === u.paying)
        .filter((u) => !f.gactive || (f.gactive === 'active') === u.active),
    [inScope, f],
  );
  const { byState, unknown } = useMemo(() => stateStats(users), [users]);
  const rows = useMemo(() => [...byState.values()].sort((a, b) => b.customers - a.customers || a.name.localeCompare(b.name)), [byState]);

  const agents = useMemo(() => state.agents.filter((a) => a.role === 'agent' && isActive(a) && a.apps.some((x) => apps.includes(x))), [state.agents, apps]);
  const agentsFor = (name: string) => agents.filter((a) => a.languages.includes(languageForState(name))).length;

  const languageTotals = useMemo(() => {
    const t = new Map<Language, number>();
    for (const u of users) t.set(u.language, (t.get(u.language) ?? 0) + 1);
    return CUSTOMER_LANGUAGES.map((l) => ({ label: l, value: t.get(l) ?? 0, color: LANGUAGE_COLOR[l] })).filter((d) => d.value > 0);
  }, [users]);

  const top = rows[0];
  const noAgent = rows.filter((r) => agentsFor(r.name) === 0);
  const sel = picked ? byState.get(picked) : undefined;

  return (
    <div className="page">
      <PageHead
        title="Customer map"
        desc="Where customers are. Hover a state for its numbers, click it to pick it."
        actions={<Segmented label="Colour by" value={mode} onChange={setMode} options={[{ value: 'customers', label: 'By state' }, { value: 'language', label: 'By language' }]} />}
      />
      <FilterBar active={active} onReset={reset} shown={users.length} total={inScope.length} noun="customers">
        {apps.length > 1 && <SelectFilter label="Product" value={f.gprod} onChange={(v) => set('gprod', v)} options={APPS_LIST.filter((a) => apps.includes(a.id)).map((a) => ({ value: a.id, label: a.name }))} />}
        <SelectFilter label="Language" value={f.glang} onChange={(v) => set('glang', v)} options={CUSTOMER_LANGUAGES.map((l) => ({ value: l, label: l }))} />
        <SelectFilter label="Plan" value={f.gplan} onChange={(v) => set('gplan', v)} all="Plan: any" options={[{ value: 'paying', label: 'Paying' }, { value: 'free', label: 'Not paying' }]} />
        <SelectFilter label="Activity" value={f.gactive} onChange={(v) => set('gactive', v)} all="Activity: any" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
      </FilterBar>

      <div className="stats">
        <Stat label="States with customers" value={rows.length} />
        <Stat label={`${top?.name ?? 'Top state'} share`} value={users.length ? `${Math.round(((top?.customers ?? 0) / users.length) * 100)}%` : '—'} />
        <Stat label="No state on record" value={nf(unknown.customers)} tone={unknown.customers ? 'warn' : undefined} note="Not drawn on the map" />
        <Stat label="States with no agent" value={noAgent.length} tone={noAgent.length ? 'danger' : 'ok'} note={noAgent.length ? 'Nobody speaks their language' : 'Every state is covered'} />
      </div>

      <div className="cust-layout" style={{ gridTemplateColumns: 'minmax(0, 6fr) minmax(0, 5fr)' }}>
        <Card title={mode === 'customers' ? 'Customers by state' : 'Language by state'}>
          <IndiaMap stats={byState} mode={mode} selected={picked} onSelect={setPicked} agentsFor={agentsFor} legend={languageTotals} />
        </Card>

        <div className="stack" style={{ gap: 16 }}>
          {sel ? (
            <Card title={sel.name} actions={<button type="button" className="btn btn--sm btn--ghost" onClick={() => setPicked(null)}>Clear</button>}>
              <div className="stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
                  <div><div className="muted" style={{ fontSize: 12.5 }}>Customers</div><b className="mono" style={{ fontSize: 22 }}>{nf(sel.customers)}</b></div>
                  <div><div className="muted" style={{ fontSize: 12.5 }}>Active</div><b className="mono" style={{ fontSize: 22 }}>{nf(sel.active)}</b></div>
                  <div><div className="muted" style={{ fontSize: 12.5 }}>Paying</div><b className="mono" style={{ fontSize: 22 }}>{nf(sel.paying)}</b></div>
                  {sel.mrr > 0 && <div><div className="muted" style={{ fontSize: 12.5 }}>MRR</div><b className="mono" style={{ fontSize: 22 }}>{inrLabel(sel.mrr)}</b></div>}
                </div>
                <BarList ariaLabel={`${sel.name} by language`} data={(Object.entries(sel.byLanguage) as [Language, number][]).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: LANGUAGE_COLOR[label] }))} />
                <span className="muted" style={{ fontSize: 13 }}>{agentsFor(sel.name)} agent{agentsFor(sel.name) === 1 ? '' : 's'} speak {languageForState(sel.name)}.</span>
                <Link to={`/customers?mine=0&state=${encodeURIComponent(sel.name)}`} className="btn btn--sm" style={{ alignSelf: 'flex-start' }}>See these customers</Link>
              </div>
            </Card>
          ) : (
            <Card title={mode === 'language' ? 'Customers by language' : 'Top states'}>
              {mode === 'language' ? (
                <BarList ariaLabel="Customers by language" data={languageTotals} />
              ) : (
                <BarList ariaLabel="Top states" data={rows.slice(0, 8).map((r) => ({ label: r.name, value: r.customers }))} />
              )}
            </Card>
          )}
          {unknown.customers > 0 && <Callout tone="warn">{nf(unknown.customers)} customers have no state on record, so they are not on the map. The next product sync fills it in where the product has it.</Callout>}
        </div>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>State</th><th className="r">Customers</th><th className="r">Active</th><th className="r">Paying</th><th className="r">MRR</th><th>Called in</th><th>Agents who speak it</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const a = agentsFor(r.name);
              return (
                <tr key={r.name} className={`is-clickable${picked === r.name ? ' is-selected' : ''}`} onClick={() => setPicked(picked === r.name ? null : r.name)}>
                  <td><b style={{ fontWeight: 500 }}>{r.name}</b></td>
                  <td className="r mono">{nf(r.customers)}</td>
                  <td className="r mono">{nf(r.active)}</td>
                  <td className="r mono">{nf(r.paying)}</td>
                  <td className="r mono">{r.mrr ? inrLabel(r.mrr) : '—'}</td>
                  <td><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: LANGUAGE_COLOR[dominantLanguage(r)], marginRight: 6 }} aria-hidden />{dominantLanguage(r)}</td>
                  <td>{a === 0 ? <Badge tone="danger">None</Badge> : <span className="mono">{a}</span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No customers with a state yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
