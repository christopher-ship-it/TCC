// Who to call again, and when. Every customer with a follow-up date — one an agent chose on the call card, the
// automatic daily calls after an unanswered first try, or the weekly chain for positive customers — grouped by day.
// Filters: overdue, today, tomorrow, this week, everything upcoming, or any range of dates.

import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, Headset } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../store/StoreContext';
import { useScope } from '../shell/scope';
import { APPS } from '../data/seed';
import { PRIORITIES, RATINGS, type CustomerUser, type Lead, type Priority } from '../data/types';
import { FilterBar, SearchFilter, SelectFilter, useFilters } from '../ui/filters';
import { CUSTOMER_LANGUAGES } from '../lib/languages';
import { textMatch } from '../lib/filters';
import { can } from '../lib/access';
import { AUTO_FOLLOWUP_DAYS, addDays, chainDay, dayFromInput, inRange, inputFromDay, isFollowUpOf, rangeBounds, scheduledFollowUps, startOfDay, type FollowUpRange, type ScheduledFollowUp } from '../lib/followUps';
import { LeadBadge, OutcomeBadge, priorityRowStyle } from '../components/calls/badges';
import { Button, Card, Chip, Empty, Input, PageHead, Select } from '../ui/primitives';
import { Pager, usePaged } from '../ui/Pager';
import { CustomerName } from '../components/customers/CustomerDetails';

const RANGES: { key: FollowUpRange; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This week' },
  { key: 'upcoming', label: 'All upcoming' },
  { key: 'custom', label: 'Custom dates' },
];

function dayTitle(dueTs: number, today: number): string {
  const date = new Date(dueTs).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const diff = Math.round((dueTs - today) / 86_400_000);
  if (diff === 0) return `Today · ${date}`;
  if (diff === 1) return `Tomorrow · ${date}`;
  if (diff < 0) return `${date} · ${-diff} day${diff === -1 ? '' : 's'} late`;
  return date;
}

function why(f: ScheduledFollowUp): string {
  if (f.kind === 'agent') return 'Agent set the date';
  if (f.kind === 'auto') return f.user.autoFollowUp ? `No answer yet · day ${Math.min(chainDay(f.user.autoFollowUp), AUTO_FOLLOWUP_DAYS)} of ${AUTO_FOLLOWUP_DAYS}` : 'No answer yet · daily call';
  return `Weekly positive · week ${f.user.followUp?.weekNumber ?? 1}`;
}

export default function FollowUps() {
  const { state, dispatch, currentAgent } = useStore();
  const me = currentAgent!;
  const { apps } = useScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isAgent = me.role === 'agent';
  const { values: g, set: setG, reset: resetG, active: gActive } = useFilters(['fq', 'fprod', 'flang', 'fprio', 'fkind', 'frate'] as const);

  // Filters live in the address, so a filtered view can be bookmarked or sent to someone.
  const rangeParam = params.get('when') as FollowUpRange | null;
  const range: FollowUpRange = RANGES.some((r) => r.key === rangeParam) ? rangeParam! : 'today';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const leadParam = params.get('lead');
  const lead: Lead | 'any' = leadParam === 'positive' || leadParam === 'negative' ? leadParam : 'any';
  const who = params.get('who') ?? (isAgent ? 'me' : 'all');
  const set = (k: string, v: string | null) =>
    setParams((p) => {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
      return p;
    }, { replace: true });

  const now = Date.now();
  const today = startOfDay(now);

  const agentOf = (u: CustomerUser) => (u.ownerAgentId ? state.agents.find((a) => a.id === u.ownerAgentId)?.name : undefined) ?? u.callHistory[0]?.agentName;
  const agentChoices = useMemo(() => state.agents.filter((a) => a.role === 'agent' && !a.superAdmin).sort((a, b) => a.name.localeCompare(b.name)), [state.agents]);

  // Everyone this person may see, before the date filter (the date chips show counts from this).
  const scoped = useMemo(() => {
    const whoAgent = who === 'me' ? me : who !== 'all' ? state.agents.find((a) => a.id === who) : undefined;
    return scheduledFollowUps(state.users.filter((u) => apps.includes(u.app)))
      .filter((f) => lead === 'any' || f.user.lead === lead)
      .filter((f) => !g.fprod || f.user.app === g.fprod)
      .filter((f) => !g.flang || f.user.language === g.flang)
      .filter((f) => !g.fprio || (f.user.priority ?? 'none') === g.fprio)
      .filter((f) => !g.frate || (f.user.rating ?? 'none') === g.frate)
      .filter((f) => !g.fkind || f.kind === g.fkind)
      .filter((f) => textMatch(g.fq, f.user.name, f.user.business, f.user.phone))
      .filter((f) => !whoAgent || isFollowUpOf(f.user, whoAgent));
  }, [state.users, state.agents, apps, lead, who, me, g]);

  const customRange = { from: dayFromInput(from), to: dayFromInput(to) };
  const bounds = rangeBounds(range, now, customRange);
  const shown = scoped.filter((f) => inRange(f.dueTs, bounds));
  const count = (r: FollowUpRange) => scoped.filter((f) => inRange(f.dueTs, rangeBounds(r, now, customRange))).length;

  // One page of follow-ups at a time, still grouped by day; a day's heading counts all of that day's, not just the page's.
  const { items: pageItems, pager } = usePaged(shown, `${range}|${from}|${to}|${lead}|${who}|${Object.values(g).join('|')}|${apps.join()}`);
  const perDay = new Map<number, number>();
  for (const f of shown) perDay.set(f.dueTs, (perDay.get(f.dueTs) ?? 0) + 1);
  const days = useMemo(() => {
    const map = new Map<number, ScheduledFollowUp[]>();
    for (const f of pageItems) map.set(f.dueTs, [...(map.get(f.dueTs) ?? []), f]);
    return [...map.entries()];
  }, [pageItems]);

  const multiApp = apps.length > 1;
  const callable = (u: CustomerUser) => isAgent && can(me, u.app, 'call');
  const rangeName = range === 'custom' ? (from || to ? 'in these dates' : 'with a date') : RANGES.find((r) => r.key === range)!.label.toLowerCase();

  return (
    <div className="page">
      <PageHead title="Follow-ups" desc="Customers to call again, by the date set on their last call. Click a customer to open them." />

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label="When">
        {RANGES.map((r) => {
          const n = r.key === 'custom' ? null : count(r.key);
          return (
            <Chip key={r.key} pressed={range === r.key} onClick={() => set('when', r.key === 'today' ? null : r.key)}>
              {r.label}{n !== null ? <span className="muted tabular-nums"> · {n}</span> : null}
            </Chip>
          );
        })}
      </div>

      {range === 'custom' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">From</span>
            <Input type="date" value={from} max={to || undefined} onChange={(e) => set('from', e.target.value)} aria-label="From date" style={{ width: 160 }} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">To</span>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => set('to', e.target.value)} aria-label="To date" style={{ width: 160 }} />
          </label>
          <Button size="sm" onClick={() => setParams((p) => { p.set('from', inputFromDay(today)); p.set('to', inputFromDay(addDays(today, 6))); return p; }, { replace: true })}>Next 7 days</Button>
          {(from || to) && <Button size="sm" onClick={() => setParams((p) => { p.delete('from'); p.delete('to'); return p; }, { replace: true })}>Clear dates</Button>}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {isAgent ? (
          <>
            <Chip pressed={who === 'me'} onClick={() => set('who', null)}>Mine</Chip>
            <Chip pressed={who === 'all'} onClick={() => set('who', 'all')}>Everyone’s</Chip>
          </>
        ) : (
          <Select aria-label="Agent" value={who} onChange={(e) => set('who', e.target.value === 'all' ? null : e.target.value)} style={{ maxWidth: 220 }}>
            <option value="all">All agents</option>
            {agentChoices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        )}
        <span className="muted" aria-hidden style={{ margin: '0 4px' }}>·</span>
        <Chip pressed={lead === 'any'} onClick={() => set('lead', null)}>Any result</Chip>
        <Chip pressed={lead === 'positive'} onClick={() => set('lead', 'positive')}>Positive</Chip>
        <Chip pressed={lead === 'negative'} onClick={() => set('lead', 'negative')}>Negative</Chip>
      </div>

      <FilterBar active={gActive} onReset={resetG} shown={shown.length} total={scoped.length} noun="follow-ups">
        <SearchFilter value={g.fq} onChange={(v) => setG('fq', v)} placeholder="Name, business or mobile" label="Find a customer" />
        {apps.length > 1 && <SelectFilter label="Product" value={g.fprod} onChange={(v) => setG('fprod', v)} options={APPS.filter((a) => apps.includes(a.id)).map((a) => ({ value: a.id, label: a.name }))} />}
        <SelectFilter label="Language" value={g.flang} onChange={(v) => setG('flang', v)} options={CUSTOMER_LANGUAGES.map((l) => ({ value: l, label: l }))} />
        <SelectFilter label="Priority" value={g.fprio} onChange={(v) => setG('fprio', v)} options={[...PRIORITIES.map((p) => ({ value: p, label: p })), { value: 'none', label: 'No priority' }]} />
        <SelectFilter label="Grade" value={g.frate} onChange={(v) => setG('frate', v)} options={[...RATINGS.map((r) => ({ value: r, label: r })), { value: 'none', label: 'Not graded' }]} />
        <SelectFilter label="Why" value={g.fkind} onChange={(v) => setG('fkind', v)} options={[{ value: 'agent', label: 'Date an agent set' }, { value: 'auto', label: 'No answer, daily call' }, { value: 'weekly', label: 'Weekly (positive)' }]} />
      </FilterBar>

      {days.length === 0 ? (
        <Card>
          <Empty icon={<CalendarClock size={22} />} title={`No follow-ups ${rangeName}`}>
            {scoped.length ? 'Try another date filter.' : 'Pick a date under “Call them again on” when you complete a call, and it shows up here.'}
          </Empty>
        </Card>
      ) : (
        days.map(([dueTs, list]) => (
          <Card key={dueTs} title={dayTitle(dueTs, today)} sub={`${perDay.get(dueTs) ?? list.length} customer${(perDay.get(dueTs) ?? list.length) === 1 ? '' : 's'}`} pad={false}>
            <Table>
              <TableHeader>
                <TableRow data-head>
                  <TableHead>Customer</TableHead>
                  {multiApp && <TableHead>Product</TableHead>}
                  <TableHead>Priority</TableHead>
                  <TableHead>Positive / negative</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Last call</TableHead>
                  <TableHead>Agent</TableHead>
                  {isAgent && <TableHead className="text-right"><span className="sr-only">Call</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((f) => {
                  const u = f.user;
                  const last = u.callHistory[0];
                  return (
                    <TableRow key={u.id} className="cursor-pointer" style={priorityRowStyle(u.priority)} onClick={() => navigate(`/customers/${u.id}`)}>
                      <TableCell>
                        <CustomerName user={u} />
                        <div className="mono muted" style={{ fontSize: 12 }}>{u.phone}</div>
                      </TableCell>
                      {multiApp && <TableCell>{APPS.find((a) => a.id === u.app)?.name}</TableCell>}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Select aria-label={`Priority for ${u.name}`} value={u.priority ?? ''} onChange={(e) => dispatch({ type: 'SET_PRIORITY', userId: u.id, priority: (e.target.value || null) as Priority | null })} style={{ minWidth: 104 }}>
                          <option value="">No priority</option>
                          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </Select>
                      </TableCell>
                      <TableCell>{u.lead ? <><LeadBadge lead={u.lead} />{u.rating && <span className="muted" style={{ fontSize: 12.5, marginLeft: 6 }}>{u.rating}</span>}</> : <span className="muted">—</span>}</TableCell>
                      <TableCell className="text-muted-foreground">{why(f)}</TableCell>
                      <TableCell style={{ maxWidth: 320 }}>
                        {last ? (
                          <>
                            <div className="row" style={{ gap: 6 }}><OutcomeBadge call={last} /><span className="muted" style={{ fontSize: 12.5 }}>{last.atLabel}</span></div>
                            {last.comment && <div className="truncate muted" style={{ fontSize: 12.5, marginTop: 2 }} title={last.comment}>{last.comment}</div>}
                          </>
                        ) : (
                          <span className="muted">Never called</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{agentOf(u) ?? 'Anyone'}</TableCell>
                      {isAgent && (
                        <TableCell className="text-right">
                          {callable(u) && (
                            <Button size="sm" variant="primary" icon={<Headset size={14} />} onClick={(e) => { e.stopPropagation(); navigate(`/work/${u.app}?focus=${u.id}&call=1`); }}>
                              Call
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        ))
      )}
      {shown.length > 0 && <Pager pager={pager} noun="follow-ups" />}
    </div>
  );
}
