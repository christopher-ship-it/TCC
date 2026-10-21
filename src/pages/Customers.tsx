// Every customer someone can work, newest first. A row opens the customer: details, every call, recordings,
// transcripts and how the conversation has gone over time.

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useStore } from '../store/StoreContext';
import { APPS } from '../data/seed';
import { AddCustomerDialog } from '../components/customers/AddCustomerDialog';
import { LeadBadge } from '../components/calls/badges';
import type { Lead } from '../data/types';
import { Chip, Empty, Input, PageHead, Button } from '../ui/primitives';
import { isConnected } from '../lib/metrics';
import { useToast } from '../ui/toastContext';

export default function Customers() {
  const { state, currentAgent } = useStore();
  const me = currentAgent!;
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(me.role === 'agent');
  const [adding, setAdding] = useState(false);
  // ?lead=positive lets other pages link straight to the positive customers.
  const [params, setParams] = useSearchParams();
  const leadParam = params.get('lead');
  const lead: Lead | 'any' = leadParam === 'positive' || leadParam === 'negative' ? leadParam : 'any';
  const setLead = (l: Lead | 'any') => setParams((p) => { if (l === 'any') p.delete('lead'); else p.set('lead', l); return p; }, { replace: true });
  const apps = me.role === 'admin' ? APPS.map((a) => a.id) : me.apps;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, '');
    return state.users
      .filter((u) => apps.includes(u.app) && !u.deleted)
      .filter((u) => !mine || u.ownerAgentId === me.id || u.callHistory.some((c) => c.agentName === me.name))
      .filter((u) => lead === 'any' || u.lead === lead)
      .filter((u) => !t || u.name.toLowerCase().includes(t) || u.business.toLowerCase().includes(t) || (digits.length >= 3 && u.phone.replace(/\D/g, '').includes(digits)))
      .sort((a, b) => (b.callHistory[0]?.atTs ?? 0) - (a.callHistory[0]?.atTs ?? 0) || a.name.localeCompare(b.name));
  }, [state.users, apps, mine, me.id, me.name, q, lead]);

  const ownerName = (id: string | null) => (id ? state.agents.find((a) => a.id === id)?.name ?? '—' : 'Anyone');

  return (
    <div className="page">
      <PageHead
        title="Customers"
        desc="Click a customer for their details, every call, recordings and analysis."
        actions={<Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setAdding(true)}>Add customer</Button>}
      />
      <div className="row" style={{ gap: 8 }}>
        <Chip pressed={mine} onClick={() => setMine(true)}>Mine</Chip>
        <Chip pressed={!mine} onClick={() => setMine(false)}>All</Chip>
        <span className="muted" aria-hidden style={{ margin: '0 4px' }}>·</span>
        <Chip pressed={lead === 'any'} onClick={() => setLead('any')}>Any result</Chip>
        <Chip pressed={lead === 'positive'} onClick={() => setLead('positive')}>Positive</Chip>
        <Chip pressed={lead === 'negative'} onClick={() => setLead('negative')}>Negative</Chip>
        <Input aria-label="Find a customer" placeholder="Name or mobile number" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280, marginLeft: 'auto' }} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty title={state.users.length === 0 ? 'No customers yet' : 'Nobody matches'} action={<Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setAdding(true)}>Add customer</Button>}>
            {state.users.length === 0 ? 'Add a customer with their mobile number, then call them.' : lead !== 'any' ? `Nobody is marked ${lead}${mine ? ' among yours — try “All”' : ''}.` : mine ? 'Try “All”.' : undefined}
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
                <TableHead>Positive / negative</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead>Last call</TableHead>
                <TableHead>Stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 500).map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => navigate(`/customers/${u.id}`)}>
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="mono muted" style={{ fontSize: 12 }}>{u.phone}</div>
                  </TableCell>
                  {apps.length > 1 && <TableCell>{APPS.find((a) => a.id === u.app)?.name}</TableCell>}
                  <TableCell>{u.customerType ? <Badge variant="outline">{u.customerType}</Badge> : <span className="muted">—</span>}</TableCell>
                  <TableCell>{u.lead ? <LeadBadge lead={u.lead} /> : <span className="muted">—</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{ownerName(u.ownerAgentId)}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.callHistory.length}<span className="muted"> · {u.callHistory.filter(isConnected).length} connected</span></TableCell>
                  <TableCell className="text-muted-foreground">{u.callHistory[0]?.atLabel ?? 'Never called'}</TableCell>
                  <TableCell className="text-muted-foreground">{u.stageTag}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
