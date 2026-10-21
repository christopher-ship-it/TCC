// A person's inbox: things someone asked them to do in the app. Today that is "please choose a new password",
// sent by an admin or the super admin. It shows as a bell in the header and as a card on every page until done.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, KeyRound } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useStore } from '../../store/StoreContext';
import type { Notice } from '../../store/context';
import { fmtDayTime } from '../../lib/dates';
import { Button, Callout, Field, Input } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

/** Choose a new password (also from the user menu, unasked). */
export function ChangePasswordDialog({ onClose, reason }: { onClose: () => void; reason?: string }) {
  const { changeMyPassword } = useStore();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 6) return setError('Use at least 6 characters.');
    if (pw !== again) return setError('The two passwords don’t match.');
    if (!changeMyPassword) return;
    setBusy(true);
    const r = await changeMyPassword(pw);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    toast('Password changed. Use the new one next time you sign in.');
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a new password</DialogTitle>
          <DialogDescription>{reason ?? 'You stay signed in here; other devices are signed out.'}</DialogDescription>
        </DialogHeader>
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => void submit(e)}>
          <Field label="New password" htmlFor="cp-1" hint="At least 6 characters.">
            <Input id="cp-1" type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setError(null); }} />
          </Field>
          <Field label="New password again" htmlFor="cp-2">
            <Input id="cp-2" type="password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setError(null); }} />
          </Field>
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Later</Button>
            <Button type="submit" variant="primary" disabled={busy || !pw || !again}>{busy ? 'Saving…' : 'Change password'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The bell in the header, with the count of open requests. */
export function InboxBell() {
  const { notices, dismissNotice } = useStore();
  const [open, setOpen] = useState<Notice | null>(null);
  const navigate = useNavigate();
  if (!notices) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="shell-pill" aria-label={`Inbox, ${notices.length} open`} style={{ position: 'relative', padding: '0 10px' }}>
            <Bell size={16} />
            {notices.length > 0 && <span className="shell-nav__badge" style={{ marginLeft: 2 }}>{notices.length}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" style={{ width: 320 }}>
          <DropdownMenuLabel>Inbox</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {notices.length === 0 ? (
            <div className="muted" style={{ padding: '8px 10px', fontSize: 13 }}>Nothing waiting for you.</div>
          ) : (
            notices.map((n) => (
              <button key={n.id} type="button" className="w-full rounded-md px-2.5 py-2 text-left hover:bg-secondary" onClick={() => (n.kind === 'password_change' ? setOpen(n) : n.kind === 'password_request' ? navigate('/system') : void dismissNotice?.(n.id))}>
                <div className="text-sm font-medium">{n.title}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{n.body}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{n.fromName} · {fmtDayTime(n.ts)}</div>
              </button>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {open && <ChangePasswordDialog reason={open.body} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The card at the top of every page while a password change is outstanding. */
export function InboxBanner() {
  const { notices } = useStore();
  const [open, setOpen] = useState(false);
  const ask = notices?.find((n) => n.kind === 'password_change');
  if (!ask) return null;
  return (
    <div style={{ padding: '12px 24px 0' }}>
      <Callout tone="warn" icon={<KeyRound size={16} />}>
        <span className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <span><b>{ask.title}.</b> {ask.body}</span>
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Change password</Button>
        </span>
      </Callout>
      {open && <ChangePasswordDialog reason={ask.body} onClose={() => setOpen(false)} />}
    </div>
  );
}
