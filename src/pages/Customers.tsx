// Every customer someone can work, newest first. A row opens the customer: details, every call, recordings,
// transcripts and how the conversation has gone over time.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useStore } from '../store/StoreContext';
import { APPS } from '../data/seed';
import { AddCustomerDialog } from '../components/customers/AddCustomerDialog';
import { LeadBadge, PriorityBadge } from '../components/calls/badges';
import { PRIORITIES, QUEUES, RATINGS } from '../data/types';
import { Empty, PageHead, Button } from '../ui/primitives';
import { ChipFilter, FilterBar, SearchFilter, SelectFilter, useFilters } from '../ui/filters';
import { CUSTOMER_LANGUAGES } from '../lib/languages';
import { queueOf } from '../lib/queue';
import { textMatch } from '../lib/filters';
import { isConnected } from '../lib/metrics';
import { useToast } from '../ui/toastContext';
import { Pager, usePaged } from '../ui/Pager';
import { CustomerName } from '../components/customers/CustomerDetails';

export default function Customers() {
  const { state, currentAgent } = useStore();
  const me = currentAgent!;
  const navigate = useNavigate();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  // Every filter lives in the address, so ?lead=positive (or any other) can be linked to straight from other pages.
  const { values: f, set, reset, active } = useFilters(['q', 'mine', 'lead', 'prod', 'lang', 'state', 'list', 'prio', 'rating', 'type', 'called'] as const, { mine: me.role === 'agent' ? '1' : '0' });
  const mine = f.mine === '1';
  const apps = me.role === 'admin' ? APPS.map((a) => a.id) : me.apps;

  const base = useMemo(
    () => state.users.filter((u) => apps.includes(u.app) && !u.deleted && (!mine || u.ownerAgentId === me.id || u.callHistory.some((c) => c.agentName === me.name))),
    [state.users, apps, mine, me.id, me.name],
  );
  const rows = useMemo(
    () =>
      base
        .filter((u) => !f.lead || u.lead === f.lead)
        .filter((u) => !f.prod || u.app === f.prod)
        .filter((u) => !f.lang || u.language === f.lang)
        .filter((u) => !f.state || u.effectiveState === f.state)
        .filter((u) => !f.list || (queueOf(u, Date.now()) ?? 'none') === f.list)
        .filter((u) => !f.prio || (u.priority ?? 'none') === f.prio)
        .filter((u) => !f.rating || (u.rating ?? 'none') === f.rating)
        .filter((u) => !f.type || (u.customerType ?? 'none') === f.type)
        .filter((u) => !f.called || (f.called === 'never' ? u.callHistory.length === 0 : u.callHistory.length > 0))
        .filter((u) => textMatch(f.q, u.name, u.business, u.phone, u.city))
        .sort((a, b) => (b.callHistory[0]?.atTs ?? 0) - (a.callHistory[0]?.atTs ?? 0) || a.name.localeCompare(b.name)),
    [base, f],
  );
  const types = useMemo(() => [...new Set(base.map((u) => u.customerType).filter((t): t is string => !!t))].sort(), [base]);
  const states = useMemo(() => [...new Set(base.map((u) => u.effectiveState))].sort(), [base]);

  const { items: pageRows, pager } = usePaged(rows, Object.values(f).join('|') + apps.join());

  const ownerName = (id: string | null) => (id ? state.agents.find((a) => a.id === id)?.name ?? '—' : 'Anyone');

  return (
    <div className="page">
      <PageHead
        title="Customers"
        desc="Click a customer for their details, every call, recordings and analysis."
        actions={<Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setAdding(true)}>Add customer</Button>}
      />
      <FilterBar active={active} onReset={reset} shown={rows.length} total={base.length} noun="customers">
        <ChipFilter label="Whose" value={f.mine || '0'} onChange={(v) => set('mine', v)} options={[{ value: '1', label: 'Mine' }, { value: '0', label: 'All' }]} />
        <SearchFilter value={f.q} onChange={(v) => set('q', v)} placeholder="Name, business or mobile" label="Find a customer" />
        <ChipFilter label="Result" value={f.lead} onChange={(v) => set('lead', v)} options={[{ value: '', label: 'Any result' }, { value: 'positive', label: 'Positive' }, { value: 'negative', label: 'Negative' }]} />
        {apps.length > 1 && <SelectFilter label="Product" value={f.prod} onChange={(v) => set('prod', v)} options={APPS.filter((a) => apps.includes(a.id)).map((a) => ({ value: a.id, label: a.name }))} />}
        <SelectFilter label="Language" value={f.lang} onChange={(v) => set('lang', v)} options={CUSTOMER_LANGUAGES.map((l) => ({ value: l, label: l }))} />
        <SelectFilter label="State" value={f.state} onChange={(v) => set('state', v)} options={states.map((x) => ({ value: x, label: x }))} />
        <SelectFilter label="Call list" value={f.list} onChange={(v) => set('list', v)} options={[...QUEUES.map((q) => ({ value: q.key, label: q.label })), { value: 'none', label: 'In no list' }]} />
        <SelectFilter label="Priority" value={f.prio} onChange={(v) => set('prio', v)} options={[...PRIORITIES.map((p) => ({ value: p, label: p })), { value: 'none', label: 'No priority' }]} />
        <SelectFilter label="Grade" value={f.rating} onChange={(v) => set('rating', v)} options={[...RATINGS.map((r) => ({ value: r, label: r })), { value: 'none', label: 'Not graded' }]} />
        {types.length > 0 && <SelectFilter label="Type" value={f.type} onChange={(v) => set('type', v)} options={[...types.map((t) => ({ value: t, label: t })), { value: 'none', label: 'No type' }]} />}
        <ChipFilter label="Called" value={f.called} onChange={(v) => set('called', v)} options={[{ value: '', label: 'Any' }, { value: 'never', label: 'Never called' }, { value: 'yes', label: 'Called' }]} />
      </FilterBar>

      {rows.length === 0 ? (
        <Card>
          <Empty title={state.users.length === 0 ? 'No customers yet' : 'Nobody matches'} action={<Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setAdding(true)}>Add customer</Button>}>
            {state.users.length === 0 ? 'Add a customer with their mobile number, then call them.' : 'Try clearing a filter.'}
          </Empty>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow data-head>
                <TableHead>Customer</TableHead>
                {apps.length > 1 && <TableHead>Product</TableHead>}
                <TableHead>Type</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Positive / negative</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead>Last call</TableHead>
                <TableHead>Stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => navigate(`/customers/${u.id}`)}>
                  <TableCell>
                    <CustomerName user={u} />
                    <div className="mono muted" style={{ fontSize: 12 }}>{u.phone}</div>
                  </TableCell>
                  {apps.length > 1 && <TableCell>{APPS.find((a) => a.id === u.app)?.name}</TableCell>}
                  <TableCell>{u.customerType ? <Badge variant="outline">{u.customerType}</Badge> : <span className="muted">—</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{u.language}</TableCell>
                  <TableCell>{u.lead ? <><LeadBadge lead={u.lead} />{u.rating && <span className="muted" style={{ fontSize: 12.5, marginLeft: 6 }}>{u.rating}</span>}</> : <span className="muted">—</span>}</TableCell>
                  <TableCell>{u.priority ? <PriorityBadge priority={u.priority} /> : <span className="muted">—</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{ownerName(u.ownerAgentId)}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.callHistory.length}<span className="muted"> · {u.callHistory.filter(isConnected).length} connected</span></TableCell>
                  <TableCell className="text-muted-foreground">{u.callHistory[0]?.atLabel ?? 'Never called'}</TableCell>
                  <TableCell className="text-muted-foreground">{u.stageTag}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-3"><Pager pager={pager} noun="customers" /></div>
        </Card>
      )}

      {adding && (
        <AddCustomerDialog
          onClose={() => setAdding(false)}
          callLabel={me.role === 'agent' ? 'Add and call' : undefined}
          onAdded={(c, call) => {
            setAdding(false);
            toast(`${c.name} added`);
            navigate(call ? `/work/${c.app}?focus=${c.id}&call=1` : `/customers/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
