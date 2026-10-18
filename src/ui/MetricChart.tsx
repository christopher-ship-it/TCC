// A Cloudflare-style metric card: label, big number, a thin line chart with the axis on the right, and a quiet
// "No data" state (a faint wave with a pill) instead of an empty box.
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface MetricPoint {
  label: string;
  value: number;
}

function EmptyWave() {
  return (
    <div className="relative h-full w-full" role="img" aria-label="No data">
      <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        <path d="M0 80 C 40 70, 60 90, 100 78 S 160 40, 200 60 S 270 95, 310 70 S 370 60, 400 75 L400 120 L0 120 Z" fill="var(--surface-3)" opacity="0.7" />
        <path d="M0 80 C 40 70, 60 90, 100 78 S 160 40, 200 60 S 270 95, 310 70 S 370 60, 400 75" fill="none" stroke="var(--line)" strokeWidth="1.5" />
      </svg>
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-3 py-1 text-[13px] text-muted-foreground shadow-sm">No data</span>
    </div>
  );
}

export function MetricChart({ title, value, note, data, height = 190 }: { title: string; value: string; note?: string; data: MetricPoint[]; height?: number }) {
  const hasData = data.some((d) => d.value > 0);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] leading-tight font-semibold tabular-nums">{value}</span>
          {note && <span className="text-[13px] text-muted-foreground">{note}</span>}
        </div>
        <div style={{ height }} className="mt-2">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis orientation="right" tickLine={false} axisLine={false} width={34} allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', fontSize: 12 }} />
                <Area type="monotone" dataKey="value" name={title} stroke="var(--series-1)" strokeWidth={1.5} fill="var(--series-1)" fillOpacity={0.08} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyWave />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
