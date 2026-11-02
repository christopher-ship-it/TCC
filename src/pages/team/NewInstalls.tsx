// Who actually installed: every customer behind "Signed up today" and the New installs list, one row each, with where
// the record came from (the product's own database, or made inside TCC — which is how test records show up) and who
// holds it. A supervisor or admin can hand a customer to an agent from here.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { installs, looksLikeTest, originOf, type InstallPeriod } from '../../lib/pipeline';
import { CUSTOMER_LANGUAGES } from '../../lib/languages';
import { textMatch } from '../../lib/filters';
import { Pager, usePaged } from '../../ui/Pager';
import { Badge, Card, Empty, PageHead, Select } from '../../ui/primitives';
import { ChipFilter, FilterBar, SearchFilter, SelectFilter, useFilters } from '../../ui/filters';
import { useToast } from '../../ui/toastContext';

const dayTimeLabel = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const PERIODS = [
  { value: 'today', label: 'Signed up today' },
  { value: '7', label: 'Last 7 days' },
  { value: 'list', label: 'In New installs list' },
];

export default function NewInstalls() {
  const { state, dispatch, currentAgent } = useStore();
  const { apps } = useScope();
  const toast = useToast();
  const { values: f, set, reset, active } = useFilters(['ip', 'iq', 'ilang', 'iowner', 'isrc'] as const, { ip: 'today' });
  const period = (PERIODS.some((p) => p.value === f.ip) ? f.ip : 'today') as InstallPeriod;
  const now = Date.now();

  const people = useMemo(() => state.users.filter((u) => apps.includes(u.app)), [state.users, apps]);
  const base = useMemo(() => installs(people, period, now), [people, period, now]);
  const agents = state.agents.filter((a) => a.role === 'agent' && (a.status ?? 'active') === 'active');
  const agentName = (id: string | null) => state.agents.find((a) => a.id === id)?.name ?? null;
  const rows = base
    .filter((u) => !f.ilang || u.language === f.ilang)
    .filter((u) => !f.iowner || (f.iowner === 'none' ? !u.ownerAgentId : u.ownerAgentId === f.iowner))
    .filter((u) => !f.isrc || (f.isrc === 'product' ? originOf(u) === 'product' : originOf(u) === 'tcc'))
    .filter((u) => textMatch(f.iq, u.name, u.business, u.phone, u.city));
  const { items, pager } = usePaged(rows, Object.values(f).join('|') + apps.join());
  const fromTcc = base.filter((u) => originOf(u) === 'tcc').length;

  return (
    <div className="page">
      <PageHead title="New installs" desc="Every customer who signed up, with where the record came from and who holds it." />
      <FilterBar active={active} onReset={reset} shown={rows.length} total={base.length} noun="customers">
        <ChipFilter label="Show" value={period} onChange={(v) => set('ip', v)} options={PERIODS} />
        <SearchFilter value={f.iq} onChange={(v) => set('iq', v)} placeholder="Name, shop, number or city" label="Find a customer" />
        <SelectFilter label="Language" value={f.ilang} onChange={(v) => set('ilang', v)} options={CUSTOMER_LANGUAGES.map((l) => ({ value: l, label: l }))} />
        <SelectFilter label="Held by" value={f.iowner} onChange={(v) => set('iowner', v)} all="Anyone" options={[{ value: 'none', label: 'Nobody yet' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
        <SelectFilter label="Record from" value={f.isrc} onChange={(v) => set('isrc', v)} all="Anywhere" options={[{ value: 'product', label: 'The product’s database' }, { value: 'tcc', label: 'Made in TCC' }]} />
      </FilterBar>
      {fromTcc > 0 && <p className="text-sm text-muted-foreground">{fromTcc} of these {fromTcc === 1 ? 'was' : 'were'} made inside TCC (added by hand, dialled, or imported), not sent by the product — most likely test records.</p>}

      {rows.length === 0 ? (
        <Empty title="Nobody here">{active || period !== 'list' ? 'No customer matches. Try “In New installs list” or clear a filter.' : 'The New installs list is empty.'}</Empty>
      ) : (
        <Card pad={false}>
          <Table>
            <TableHeader>
              <TableRow data-head>
                <TableHead>Customer</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Signed up</TableHead>
                <TableHead>Language · state</TableHead>
                <TableHead>Setup step</TableHead>
                <TableHead>Record from</TableHead>
                <TableHead>Held by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link to={`/customers/${u.id}`} className="font-medium text-primary">{u.name}</Link>
                    {looksLikeTest(u) && <> <Badge tone="warn">Looks like a test</Badge></>}
                    <div className="text-xs text-muted-foreground">{u.business}{u.city && u.city !== '—' ? ` · ${u.city}` : ''}</div>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{u.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{u.sync?.registeredTs ? dayTimeLabel(u.sync.registeredTs) : u.registeredAtLabel}</TableCell>
                  <TableCell className="text-muted-foreground">{u.language}{u.stateName ?? u.state ? ` · ${u.stateName ?? u.state}` : ''}</TableCell>
                  <TableCell className="text-muted-foreground">{u.sync?.stageLabel ?? u.stageTag}</TableCell>
                  <TableCell>{originOf(u) === 'product' ? <Badge tone="ok" dot>Product database</Badge> : <Badge tone="warn" dot>Made in TCC</Badge>}</TableCell>
                  <TableCell>
                    <Select
                      aria-label={`Give ${u.name} to an agent`}
                      value={u.ownerAgentId ?? ''}
                      onChange={(e) => {
                        if (!e.target.value || !currentAgent) return;
                        dispatch({ type: 'REASSIGN_OWNER', userId: u.id, agentId: e.target.value, actorId: currentAgent.id });
                        toast(`${u.name} given to ${agentName(e.target.value) ?? 'the agent'}`);
                      }}
                    >
                      <option value="" disabled>{u.ownerAgentId ? agentName(u.ownerAgentId) : 'Nobody yet — give to…'}</option>
                      {agents.filter((a) => a.apps.includes(u.app)).map((a) => <option key={a.id} value={a.id}>{a.name} — {a.languages.join(', ')}</option>)}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-3"><Pager pager={pager} noun="customers" /></div>
        </Card>
      )}
    </div>
  );
}
