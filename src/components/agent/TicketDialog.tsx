import { useState } from 'react';
import type { CustomerUser } from '../../data/types';
import { useStore } from '../../store/StoreContext';
import { Button, Field, Select, Sheet, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

const COMMON = ['Cannot upload listing photos', 'Payment deducted, plan not active', 'OTP not received', 'App crashes on checkout', 'Wrong plan applied', 'Refund request'];

/** Raise a support ticket for a customer. It lands in the same app's Tickets & flags queue. */
export function TicketDialog({ user, onClose }: { user: CustomerUser; onClose: () => void }) {
  const { dispatch } = useStore();
  const toast = useToast();
  const [kind, setKind] = useState(COMMON[0]);
  const [detail, setDetail] = useState('');
  function submit() {
    dispatch({ type: 'RAISE_TICKET', userId: user.id, subject: detail.trim() ? `${kind} — ${detail.trim()}` : kind });
    toast('Ticket raised');
    onClose();
  }
  return (
    <Sheet
      kind="dialog"
      title="Raise a ticket"
      desc={`${user.name} · ${user.business}`}
      onClose={onClose}
      footer={
        <>
          <span style={{ marginLeft: 'auto' }} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>Raise ticket</Button>
        </>
      }
    >
      <Field label="Problem" htmlFor="tk-kind">
        <Select id="tk-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {COMMON.map((c) => <option key={c}>{c}</option>)}
          <option value="Other">Something else</option>
        </Select>
      </Field>
      <Field label="Details" htmlFor="tk-detail" hint="What the customer saw, device, when it started.">
        <Textarea id="tk-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>
    </Sheet>
  );
}
