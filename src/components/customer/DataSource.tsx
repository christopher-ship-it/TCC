// Says where a customer record came from: the product's own data (RealBroks, IronDrobe, …), a number dialled inside
// TCC, or generated demo data — and which parts of the record TCC itself wrote.
import { APPS } from '../../data/seed';
import type { CustomerUser, Origin } from '../../data/types';
import { originOf } from '../../lib/world';
import { Badge, Card } from '../../ui/primitives';

const TONE: Record<Origin, 'ok' | 'accent' | 'warn'> = { app: 'ok', tcc: 'accent', sample: 'warn' };

const appName = (user: CustomerUser) => APPS.find((a) => a.id === user.app)?.name ?? user.app;

export function OriginBadge({ user }: { user: CustomerUser }) {
  const o = originOf(user);
  const text = o === 'app' ? `From ${appName(user)}` : o === 'tcc' ? 'Created in TCC' : 'Demo data';
  const title = o === 'app' ? `This customer’s details came from ${appName(user)}.` : o === 'tcc' ? 'A number dialled inside TCC. Nothing came from the product’s own data.' : 'Generated for practice. Not a real person.';
  return <Badge tone={TONE[o]} title={title}>{text}</Badge>;
}

export function DataSourceCard({ user }: { user: CustomerUser }) {
  const o = originOf(user);
  const name = appName(user);
  const written = [
    `${user.callHistory.length} call${user.callHistory.length === 1 ? '' : 's'} logged`,
    `${user.tickets.length} ticket${user.tickets.length === 1 ? '' : 's'}`,
    user.followUp ? `follow-up chain, week ${user.followUp.weekNumber}` : null,
    user.ownerAgentId ? 'owner' : null,
    user.queue ? 'queue and stage' : null,
  ].filter(Boolean);
  return (
    <Card title="Where this record comes from">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8 }}><OriginBadge user={user} /></div>
        {o === 'app' && (
          <div className="kv"><span>From {name}</span><span style={{ textAlign: 'right' }}>name, phone, business, location, plan, activity, registration date</span></div>
        )}
        {o === 'tcc' && <span className="muted" style={{ fontSize: 13 }}>An agent dialled this number from TCC. It is not in {name}’s customer data.</span>}
        {o === 'sample' && <span className="muted" style={{ fontSize: 13 }}>Practice data. It is only ever shown to demo accounts and is never dialled for real.</span>}
        <div className="kv"><span>Created in TCC</span><span style={{ textAlign: 'right' }}>{written.join(' · ')}</span></div>
      </div>
    </Card>
  );
}
