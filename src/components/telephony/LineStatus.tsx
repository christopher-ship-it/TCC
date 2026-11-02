// The agent's phone line in the header, on every page: whether it is connected (an offline line means incoming calls
// cannot reach this agent) and a place to sign in or out without opening a customer first.

import { useEffect, useRef, useState } from 'react';
import { useTelephonyOptional } from '../../telephony';
import { useStore } from '../../store/StoreContext';
import { Button } from '../../ui/primitives';
import { SignIn } from './Phone';
import { useCallSession } from './callSessionContext';
import { announcePresence, forgetLine } from '../../lib/presence';

export function LineStatus() {
  const tel = useTelephonyOptional();
  const { currentAgent } = useStore();
  const { presenceError } = useCallSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const connection = tel?.snapshot.connection;

  // Close once the line comes up, and on any click outside.
  useEffect(() => {
    if (connection === 'ready') setOpen(false);
  }, [connection]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  if (!tel || !currentAgent || !tel.requiresCredentials) return null;
  const ready = connection === 'ready';
  const label = ready ? (presenceError ? 'Line on — not receiving calls' : 'Line on') : connection === 'connecting' ? 'Connecting line…' : 'Line off — connect';

  async function signOut() {
    await announcePresence('offline');
    forgetLine();
    tel?.controller.disconnect();
  }

  return (
    <div className="line-status" ref={box}>
      <button
        type="button"
        className={`shell-pill${ready && !presenceError ? '' : ' shell-pill--off'}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={ready ? 'Your phone line is connected: you can call and receive calls.' : 'Incoming calls can’t reach you until your phone line is connected.'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`dot ${ready && !presenceError ? 'dot--ok' : ready || connection === 'connecting' ? 'dot--warn' : 'dot--off'}`} />
        {label}
      </button>
      {open && (
        <div className="line-status__pop phone" role="dialog" aria-label="Phone line">
          {ready ? (
            <>
              {presenceError ? (
                <div className="phone__warn">You can make calls, but incoming calls can’t reach you: {presenceError}</div>
              ) : (
                <div className="phone__note">Connected and marked available. Calls to your business number ring here while this tab is open.</div>
              )}
              <Button variant="ghost" size="sm" disabled={!!tel.snapshot.call} onClick={() => void signOut()}>Sign out of the line</Button>
            </>
          ) : connection === 'connecting' ? (
            <div className="phone__note">Connecting…</div>
          ) : (
            <SignIn agent={currentAgent} failed={connection === 'failed' ? (tel.snapshot.connectionError?.reason ?? 'unknown error') : null} />
          )}
        </div>
      )}
    </div>
  );
}
