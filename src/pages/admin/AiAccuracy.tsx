// How well the AI reads calls, by the team's own verdicts, and what it is being taught. The super admin's view of the
// feedback loop: agents rate the AI's reading of each call (and the result they pick is compared with it), recent
// corrections go into the instructions for the next analysis, and this page shows whether it is getting closer.

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import { notesCall } from '../../lib/notes';
import { fmtDayTime } from '../../lib/dates';
import { outcomeLabel } from '../../brand';
import type { AiSummary } from '../../lib/aiFeedback';
import { MetricChart } from '../../ui/MetricChart';
import { Badge, Callout, Empty, PageHead, Stat, Toggle } from '../../ui/primitives';
import { FilterBar, SelectFilter, useFilters } from '../../ui/filters';
import { useToast } from '../../ui/toastContext';

interface Overview {
  summary: AiSummary;
  enabled: boolean;
  lessons: { app: string; text: string }[];
  apps: string[];
  languages: string[];
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const appName = (id: string) => APPS.find((a) => a.id === id)?.name ?? id;
const weekLabel = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function AiAccuracy() {
  const { backend } = useStore();
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { values: f, set, reset, active } = useFilters(['aiapp', 'ailang'] as const);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (f.aiapp) q.set('app', f.aiapp);
      if (f.ailang) q.set('language', f.ailang);
      setData(await notesCall<Overview>('GET', `/api/system/ai${q.size ? `?${q}` : ''}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    }
  }, [f.aiapp, f.ailang]);
  useEffect(() => {
    if (backend !== 'server') return;
    void load();
    const id = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => clearInterval(id);
  }, [backend, load]);

  async function toggle(on: boolean) {
    try {
      await notesCall('POST', '/api/system/ai/learning', { enabled: on });
      toast(on ? 'The AI now learns from your team’s corrections' : 'Learning is off: analyses use the standard instructions');
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that.');
    }
  }

  const s = data?.summary;
  return (
    <div className="page">
      <PageHead title="AI accuracy" desc="How often the AI’s reading of a call matches what your agents say, and whether it is improving. Only the super admin sees this." />

      {backend !== 'server' && <Callout tone="warn">This build has no server, so no feedback is collected here.</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}

      {data && (
        <Card>
          <CardContent style={{ paddingTop: 16 }}>
            <Toggle
              checked={data.enabled}
              onChange={(v) => void toggle(v)}
              label="Teach the AI from the team’s corrections"
              help="Gemini itself is not retrained. When on, the newest corrections are added to the instructions sent with each new call analysis, so it learns how your team reads calls. Calls already analysed are not redone."
            />
          </CardContent>
        </Card>
      )}

      <FilterBar active={active} onReset={reset} shown={s?.total} total={s?.total} noun="verdicts">
        <SelectFilter label="Product" value={f.aiapp} onChange={(v) => set('aiapp', v)} options={(data?.apps ?? []).map((a) => ({ value: a, label: appName(a) }))} />
        <SelectFilter label="Language" value={f.ailang} onChange={(v) => set('ailang', v)} options={(data?.languages ?? []).map((l) => ({ value: l, label: l }))} />
      </FilterBar>

      {s && s.total === 0 ? (
        <Card><Empty title="No feedback yet">When an agent marks the AI’s reading of a call right or wrong, or picks a result that differs from it, it is counted here. After a few corrections the AI starts learning from them.</Empty></Card>
      ) : s && (
        <>
          <div className="stats">
            <Stat label="AI marked right" value={pct(s.accuracy)} tone={s.accuracy === null ? undefined : s.accuracy >= 80 ? 'ok' : s.accuracy < 60 ? 'danger' : 'warn'} note={`${s.total.toLocaleString('en-IN')} verdicts · ${s.verdicts.good} right, ${s.verdicts.partly} partly, ${s.verdicts.wrong} wrong`} />
            <Stat label="Same result as the agent" value={pct(s.outcomeAgreement.rate)} note={`${s.outcomeAgreement.agreed} of ${s.outcomeAgreement.known} calls`} />
            <Stat label="Same read of the customer" value={pct(s.sentimentAgreement.rate)} note={`${s.sentimentAgreement.agreed} of ${s.sentimentAgreement.known} calls`} />
            <Stat label="Last 4 weeks vs the 4 before" value={s.trend === null ? '—' : `${s.trend > 0 ? '+' : ''}${s.trend} pts`} tone={s.trend === null ? undefined : s.trend > 0 ? 'ok' : s.trend < 0 ? 'danger' : undefined} note={s.trend === null ? 'Needs 5+ verdicts in each' : s.trend > 0 ? 'Getting better' : s.trend < 0 ? 'Getting worse' : 'No change'} />
          </div>

          <MetricChart
            title="Accuracy by week"
            value={pct(s.accuracy)}
            note="share the team marked right, last 12 weeks"
            data={s.weekly.map((w) => ({ label: weekLabel(w.weekStart), value: w.accuracy ?? 0 }))}
            height={160}
          />

          {s.bias.known >= 6 && (s.bias.tooHigh > 0 || s.bias.tooLow > 0) && (
            <Callout tone={Math.max(s.bias.tooHigh, s.bias.tooLow) / s.bias.known >= 0.3 ? 'warn' : undefined}>
              On how receptive customers were, the AI scored higher than the team {s.bias.tooHigh} time{s.bias.tooHigh === 1 ? '' : 's'} and lower {s.bias.tooLow} time{s.bias.tooLow === 1 ? '' : 's'} (of {s.bias.known}).
            </Callout>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>What it says versus what the team says</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow data-head><TableHead>The AI said</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Agreed</TableHead><TableHead>Team most often says instead</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {s.byOutcome.map((o) => (
                      <TableRow key={o.outcome}>
                        <TableCell className="font-medium">{outcomeLabel(o.outcome)}</TableCell>
                        <TableCell className="text-right tabular-nums">{o.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{Math.round((o.agreed / o.total) * 100)}%</TableCell>
                        <TableCell className="text-muted-foreground">{o.topCorrection ? outcomeLabel(o.topCorrection) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="stack" style={{ gap: 12 }}>
              {[{ title: 'By product', rows: s.byApp.map((g) => ({ ...g, key: appName(g.key) })) }, { title: 'By language', rows: s.byLanguage }].map((t) => (
                <Card key={t.title}>
                  <CardHeader><CardTitle>{t.title}</CardTitle></CardHeader>
                  <CardContent>
                    {t.rows.length === 0 ? <span className="muted">Nothing yet.</span> : (
                      <Table>
                        <TableBody>
                          {t.rows.map((g) => (
                            <TableRow key={g.key}>
                              <TableCell className="font-medium">{g.key}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{g.total} verdict{g.total === 1 ? '' : 's'}</TableCell>
                              <TableCell className="text-right tabular-nums">{pct(g.accuracy)} right</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader><CardTitle>What the AI is being taught right now</CardTitle></CardHeader>
            <CardContent className="stack" style={{ gap: 12 }}>
              {!data?.enabled && <Callout tone="warn">Learning is off. These would be taught if you turned it on.</Callout>}
              {(data?.lessons ?? []).filter((l) => l.text).length === 0 ? (
                <span className="muted">Nothing yet. A lesson appears once the team has corrected the same kind of mistake a few times.</span>
              ) : (
                (data?.lessons ?? []).filter((l) => l.text).map((l) => (
                  <section key={l.app}>
                    <b style={{ fontWeight: 500 }}>{appName(l.app)}</b>
                    <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, margin: '6px 0 0', color: 'var(--ink-2)' }}>{l.text}</pre>
                  </section>
                ))
              )}
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Sent with the next analysis of that product’s calls. Never includes a customer’s name or number.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent corrections</CardTitle></CardHeader>
            <CardContent>
              {s.recent.length === 0 ? <span className="muted">None.</span> : (
                <Table>
                  <TableHeader><TableRow data-head><TableHead>When</TableHead><TableHead>Product</TableHead><TableHead>Verdict</TableHead><TableHead>AI said</TableHead><TableHead>Team said</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {s.recent.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="mono text-muted-foreground" style={{ fontSize: 12 }}>{fmtDayTime(r.ts)}</TableCell>
                        <TableCell>{appName(r.app)}</TableCell>
                        <TableCell><Badge tone={r.verdict === 'wrong' ? 'danger' : r.verdict === 'partly' ? 'warn' : 'ok'}>{r.verdict}</Badge> {r.kind === 'implicit' && <span className="muted" style={{ fontSize: 11.5 }}>from the result picked</span>}</TableCell>
                        <TableCell>{r.aiOutcome ? outcomeLabel(r.aiOutcome) : '—'}</TableCell>
                        <TableCell>{r.outcome ? outcomeLabel(r.outcome) : r.sentiment ? `${r.sentiment} customer` : '—'}</TableCell>
                        <TableCell className="text-muted-foreground" style={{ whiteSpace: 'normal', maxWidth: 360 }}>{r.note ?? ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
