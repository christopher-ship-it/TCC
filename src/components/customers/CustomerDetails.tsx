// Customers the product's own database knows only by their mobile number (signed up, never filled in their shop
// details): lists say so plainly, and an agent can type in the name, shop and city from the call. What they type stays
// until the product sends its own (src/lib/appSync.ts: fillDetails, editableDetails).

import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import type { CustomerUser, DetailField } from '../../data/types';
import { editableDetails, fillDetails, nameUnknown } from '../../lib/appSync';
import { Button, Field, Input } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

const LABELS: Record<DetailField, { label: string; placeholder: string }> = {
  name: { label: 'Their name', placeholder: 'e.g. Ravi Kumar' },
  business: { label: 'Shop name', placeholder: 'e.g. Ravi Ironing Centre' },
  city: { label: 'City', placeholder: 'e.g. Coimbatore' },
};

/** The name to show in a list: "Name not given" when all TCC has is the number (shown on the line below anyway). */
export function CustomerName({ user }: { user: CustomerUser }) {
  if (!nameUnknown(user)) return <div className="font-medium">{user.name}</div>;
  return (
    <div className="font-medium" style={{ color: 'var(--muted)', fontStyle: 'italic' }} title="Signed up with just their number; no name in the app yet">
      Name not given
    </div>
  );
}

/** "Add details" for the details the product has none of; nothing when it has them all. */
export function FillDetailsButton({ user, size = 'sm' }: { user: CustomerUser; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  const fields = editableDetails(user);
  if (!fields.length || user.deleted) return null;
  const any = user.filledIn?.fields.length;
  return (
    <>
      <Button size={size} variant={nameUnknown(user) ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>
        {any ? 'Edit details' : 'Add details'}
      </Button>
      {open && <FillDetailsDialog user={user} fields={fields} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A line saying who typed which details in, for the customer page. */
export function filledInNote(user: CustomerUser): string | null {
  const f = user.filledIn;
  if (!f?.fields.length) return null;
  const what = f.fields.map((x) => (x === 'business' ? 'shop name' : x)).join(', ');
  return `${what[0].toUpperCase()}${what.slice(1)} added by ${f.byName} on ${new Date(f.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

function FillDetailsDialog({ user, fields, onClose }: { user: CustomerUser; fields: DetailField[]; onClose: () => void }) {
  const { dispatch, currentAgent } = useStore();
  const toast = useToast();
  const appName = APPS.find((a) => a.id === user.app)?.name ?? 'the app';
  // Start from what an agent typed before; placeholders the sync left start empty.
  const start = (f: DetailField) => (user.filledIn?.fields.includes(f) || (f === 'name' ? !nameUnknown(user) : f === 'business' ? user.business !== 'Customer' : user.city !== '—') ? user[f] : '');
  const [entry, setEntry] = useState<Record<DetailField, string>>(() => ({ name: start('name'), business: start('business'), city: start('city') }));

  const save = (e: FormEvent) => {
    e.preventDefault();
    const only = Object.fromEntries(fields.map((f) => [f, entry[f]])) as Partial<Record<DetailField, string>>;
    dispatch({ type: 'UPDATE_CUSTOMER', userId: user.id, patch: fillDetails(user, only, currentAgent?.name ?? 'An agent') });
    toast('Details saved');
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add their details</DialogTitle>
          <DialogDescription>
            {appName} has no {fields.map((f) => (f === 'business' ? 'shop name' : f)).join(', ')} for {user.phone}. Ask on the call and type it here. If {appName} gets its own later, that replaces yours.
          </DialogDescription>
        </DialogHeader>
        <form className="stack" style={{ gap: 12 }} onSubmit={save}>
          {fields.map((f, i) => (
            <Field key={f} label={LABELS[f].label} htmlFor={`detail-${f}`}>
              <Input id={`detail-${f}`} autoFocus={i === 0} maxLength={120} placeholder={LABELS[f].placeholder} value={entry[f]} onChange={(e) => setEntry((x) => ({ ...x, [f]: e.target.value }))} />
            </Field>
          ))}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
