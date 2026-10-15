import { Link } from 'react-router-dom';
import { formatDuration } from '../../telephony';
import type { CallRow } from '../../lib/metrics';
import { OutcomeBadge, SentimentBadge } from './badges';

/** One call in a compact list: who, when, how it went. Opens the call's detail page. */
export function CallRowItem({ row, showAgent }: { row: CallRow; showAgent?: boolean }) {
  const { user, call } = row;
  return (
    <li>
      <Link to={`/customers/${user.id}/calls/${call.id}`} className="list-link">
        <span style={{ minWidth: 0 }}>
          <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{user.name}</span>
          <span className="truncate muted" style={{ display: 'block', fontSize: 12.5 }}>
            {call.atLabel}
            {showAgent ? ` · ${call.agentName}` : ''}
            {call.telephony?.durationSec ? ` · ${formatDuration(call.telephony.durationSec)}` : ''}
          </span>
        </span>
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <SentimentBadge score={call.analysis?.sentiment} />
          <OutcomeBadge call={call} />
        </span>
      </Link>
    </li>
  );
}
