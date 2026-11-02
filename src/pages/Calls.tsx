import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, PhoneOff } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { useScope } from '../shell/scope';
import { APPS } from '../data/seed';
import { NEGATIVE_OUTCOMES, OUTCOME_LIST, POSITIVE_OUTCOMES, PRIORITIES, type AppId } from '../data/types';
import { allCalls, callsByDay, callsCsv, DAY, downloadText, durationLabel, isConnected, sentimentSummary } from '../lib/metrics';
import { canAnywhere } from '../lib/access';
import { formatDuration } from '../telephony';
import { OutcomeBadge, SentimentBadge } from '../components/calls/badges';
import { analysisState } from '../lib/callStatus';
import { ColumnChart, Legend } from '../ui/charts';
import { Badge, Button, Card, Empty, PageHead, Segmented, Select, Stat } from '../ui/primitives';
import { FilterBar, SearchFilter, SelectFilter, useFilters } from '../ui/filters';
import { CUSTOMER_LANGUAGES } from '../lib/languages';
import { textMatch } from '../lib/filters';
import { useToast } from '../ui/toastContext';
import { Pager, usePaged } from '../ui/Pager';

type Period = 'today' | '7' | '30' | 'all';
type Result = 'all' | 'connected' | 'positive' | 'negative' | 'missed' | 'flagged';

const appName = (id: AppId) => APPS.find((a) => a.id === id)?.name ?? id;

export default function Calls() {
  const { state, currentAgent, dispatch } = useStore();
  const { apps } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  const agent = currentAgent!;
  const isAgent = agent.role === 'agent';
  const [period, setPeriod] = useState<Period>('7');
  const [result, setResult] = useState<Result>('all');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const { values: f, set, reset, active: fActive } = useFilters(['prod', 'lang', 'dir', 'outcome', 'rec', 'prio'] as const);

  const since = useMemo(() => {
    if (period === 'all') return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return period === 'today' ? d.getTime() : d.getTime() - (Number(period) - 1) * DAY;
  }, [period]);

  const scoped = useMemo(() => allCalls(state.users, { apps: isAgent ? agent.apps : apps, agentName: isAgent ? agent.name : who || undefined, since }), [state.users, apps, isAgent, agent, who, since]);
  const rows = useMemo(() => {
    const flagged = new Set(sentimentSummary(scoped).flagged.map((r) => r.call.id));
    return scoped.filter(({ user, call }) => {
      if (!textMatch(q, user.name, user.business, user.phone)) return false;
      if (f.prod && user.app !== f.prod) return false;
      if (f.lang && user.language !== f.lang) return false;
      if (f.prio && (user.priority ?? 'none') !== f.prio) return false;
      if (f.dir && (call.telephony?.direction === 'inbound' ? 'in' : 'out') !== f.dir) return false;
      if (f.outcome && (call.outcome ?? 'none') !== f.outcome) return false;
      if (f.rec && !!call.telephony?.recordingFile !== (f.rec === 'yes')) return false;
      switch (result) {
        case 'connected': return isConnected(call);
        case 'missed': return !isConnected(call);
        case 'positive': return !!call.outcome && POSITIVE_OUTCOMES.includes(call.outcome);
        case 'negative': return !!call.outcome && NEGATIVE_OUTCOMES.includes(call.outcome);
        case 'flagged': return flagged.has(call.id);
        default: return true;
      }
    });
  }, [scoped, q, result, f]);

  const { items: pageRows, pager } = usePaged(rows, `${period}|${result}|${who}|${q}|${Object.values(f).join('|')}|${apps.join()}`);
  const connected = rows.filter((r) => isConnected(r.call)).length;
  const sentiment = sentimentSummary(rows);
  const talk = rows.reduce((n, r) => n + (r.call.telephony?.durationSec ?? 0), 0);
  const days = callsByDay(rows, period === '30' || period === 'all' ? 30 : 7);
  const canExport = canAnywhere(agent, 'export');
  const agents = state.agents.filter((a) => a.role === 'agent' && a.apps.some((x) => apps.includes(x)));

  function exportCsv() {
    downloadText(`tcc-calls-${new Date().toISOString().slice(0, 10)}.csv`, callsCsv(rows, appName));
    dispatch({ type: 'LOG_EXPORT', actorId: agent.id, detail: `${rows.length} calls exported (${period === 'all' ? 'all time' : period === 'today' ? 'today' : `last ${period} days`})` });
    toast(`Exported ${rows.length} calls`);
  }

  return (
    <div className="page">
      <PageHead
        title={isAgent ? 'My calls' : 'Calls & recordings'}
        desc={isAgent ? 'Every call you’ve logged, with its recording, transcript and analysis.' : 'Every call your team made. Open one to hear it, read the transcript and see how it went.'}
        actions={canExport && <Button icon={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />

      <FilterBar
        active={fActive + (result !== 'all' ? 1 : 0) + (who ? 1 : 0) + (q ? 1 : 0) + (period !== '7' ? 1 : 0)}
        onReset={() => { reset(); setResult('all'); setWho(''); setQ(''); setPeriod('7'); }}
        shown={rows.length}
        total={scoped.length}
        noun="calls"
      >
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: 'all', label: 'All time' }]} />
        <SearchFilter value={q} onChange={setQ} placeholder="Customer, business or phone" label="Filter by customer" />
        <Select aria-label="Result" value={result} onChange={(e) => setResult(e.target.value as Result)} style={{ width: 'auto' }}>
          <option value="all">Every result</option>
          <option value="connected">Connected</option>
          <option value="missed">Didn’t connect</option>
          <option value="positive">Positive outcome</option>
          <option value="negative">Said no</option>
          <option value="flagged">Negative sentiment — review</option>
        </Select>
        {!isAgent && (
          <Select aria-label="Agent" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Every agent</option>
            {agents.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
          </Select>
        )}
        {(isAgent ? agent.apps : apps).length > 1 && <SelectFilter label="Product" value={f.prod} onChange={(v) => set('prod', v)} options={APPS.filter((a) => (isAgent ? agent.apps : apps).includes(a.id)).map((a) => ({ value: a.id, label: a.name }))} />}
        <SelectFilter label="Language" value={f.lang} onChange={(v) => set('lang', v)} options={CUSTOMER_LANGUAGES.map((l) => ({ value: l, label: l }))} />
        <SelectFilter label="Direction" value={f.dir} onChange={(v) => set('dir', v)} options={[{ value: 'out', label: 'Outgoing' }, { value: 'in', label: 'Incoming' }]} />
        <SelectFilter label="What they said" value={f.outcome} onChange={(v) => set('outcome', v)} options={[...OUTCOME_LIST.map((o) => ({ value: o.outcome, label: o.outcome })), { value: 'none', label: 'Not captured' }]} />
        <SelectFilter label="Priority" value={f.prio} onChange={(v) => set('prio', v)} options={[...PRIORITIES.map((p) => ({ value: p, label: p })), { value: 'none', label: 'No priority' }]} />
        <SelectFilter label="Recording" value={f.rec} onChange={(v) => set('rec', v)} options={[{ value: 'yes', label: 'Has a recording' }, { value: 'no', label: 'No recording' }]} />
      </FilterBar>

      <div className="stats">
        <Stat label="Calls" value={rows.length.toLocaleString('en-IN')} />
        <Stat label="Connected" value={rows.length ? `${Math.round((connected / rows.length) * 100)}%` : '—'} note={`${connected} answered`} />
        <Stat label="Average sentiment" value={sentiment.average ?? '—'} note={sentiment.analysed ? `${sentiment.analysed} calls analysed` : 'No analysed calls'} tone={sentiment.average === null ? undefined : sentiment.average >= 60 ? 'ok' : sentiment.average <= 40 ? 'danger' : undefined} />
        <Stat label="Talk time" value={durationLabel(talk)} />
      </div>

      {period !== 'today' && (
        <Card title="Calls per day" actions={<Legend items={[{ label: 'Connected', color: 'var(--series-1)' }, { label: 'Didn’t connect', color: 'var(--series-4)' }]} />}>
          <ColumnChart ariaLabel="Calls per day" data={days.map((d) => ({ label: d.label, values: [d.connected, d.missed] }))} series={[{ label: 'Connected', color: 'var(--series-1)' }, { label: 'Didn’t connect', color: 'var(--series-4)' }]} />
        </Card>
      )}

      {rows.length === 0 ? (
        <Card><Empty icon={<PhoneOff size={22} />} title="No calls match">Try a longer period or a different filter.</Empty></Card>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                {!isAgent && <th>Agent</th>}
                <th>Result</th>
                <th className="r">Talk</th>
                <th>Sentiment</th>
                <th>Analysis</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ user, call }) => {
                const a = analysisState(call);
                return (
                  <tr key={call.id} className="is-clickable" onClick={() => navigate(`/customers/${user.id}/calls/${call.id}`)}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{call.atLabel}</td>
                    <td>
                      <a href={`#/customers/${user.id}/calls/${call.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--ink)', fontWeight: 500, textDecoration: 'none' }}>{user.name}</a>
                      <div className="muted" style={{ fontSize: 12.5 }}>{call.telephony?.direction === 'inbound' ? 'Incoming call · ' : ''}{appName(user.app)} · {user.city}</div>
                    </td>
                    {!isAgent && <td>{call.agentName}</td>}
                    <td><OutcomeBadge call={call} /></td>
                    <td className="r mono">{call.telephony?.durationSec ? formatDuration(call.telephony.durationSec) : '—'}</td>
                    <td><SentimentBadge score={call.analysis?.sentiment} /></td>
                    <td>{a ? <Badge tone={a.tone}>{a.label}</Badge> : <span className="subtle">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <Pager pager={pager} noun="calls" />}
    </div>
  );
}
