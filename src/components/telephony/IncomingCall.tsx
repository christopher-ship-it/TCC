// A call ringing in, shown over whatever page the agent is on: who it is (the matching customer, or the bare number),
// a ringtone, a desktop notification when the tab is in the background, and Answer / Decline. Answering opens the
// caller in the call queue, where the live call carries on in the phone panel.

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone as PhoneIcon, PhoneIncoming, PhoneOff } from 'lucide-react';
import { useTelephony } from '../../telephony';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';

/** Two-tone ring (on .4s, off .2s, on .4s, off 2s) synthesised with Web Audio, so there is no file to load. */
function useRingtone(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctx();
    } catch {
      return;
    }
    void ctx.resume().catch(() => undefined);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    for (const f of [400, 450]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start();
    }
    const burst = (at: number) => {
      gain.gain.setValueAtTime(0.08, at);
      gain.gain.setValueAtTime(0, at + 0.4);
    };
    const ring = () => {
      const t = ctx.currentTime + 0.05;
      burst(t);
      burst(t + 0.6);
    };
    ring();
    const id = setInterval(ring, 3000);
    return () => {
      clearInterval(id);
      void ctx.close().catch(() => undefined);
    };
  }, [on]);
}

/** A system notification while the tab is hidden (permission is asked when the agent connects the line). */
function useDesktopNotice(callId: string | null, title: string, body: string) {
  const shown = useRef<Notification | null>(null);
  useEffect(() => {
    if (!callId || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
    try {
      const n = new Notification(title, { body, tag: callId, requireInteraction: true });
      n.onclick = () => {
        window.focus();
        n.close();
      };
      shown.current = n;
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
    return () => {
      shown.current?.close();
      shown.current = null;
    };
  }, [callId, title, body]);
}

/** "(1) Incoming call" in the tab title while it rings. */
function useTitleFlag(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const original = document.title;
    document.title = `☎ Incoming call · ${original}`;
    return () => {
      document.title = original;
    };
  }, [on]);
}

export function IncomingCall() {
  const { controller, snapshot } = useTelephony();
  const { state } = useStore();
  const navigate = useNavigate();
  const call = snapshot.call?.state === 'incoming' && !snapshot.call.hangupRequested ? snapshot.call : null;
  const who = call?.meta.customerId ? state.users.find((u) => u.id === call.meta.customerId) : undefined;
  const number = call ? (/^\d{8,15}$/.test(call.remote) ? `+${call.remote}` : call.remote) : '';
  const name = who && !who.adHoc ? who.name : number || 'Unknown number';
  const detail = who && !who.adHoc ? [who.business, APPS.length > 1 ? APPS.find((a) => a.id === who.app)?.name : null, who.city].filter(Boolean).join(' · ') : 'Not in your customer list';

  useRingtone(!!call);
  useTitleFlag(!!call);
  useDesktopNotice(call?.id ?? null, `Incoming call — ${name}`, detail);

  if (!call) return null;

  function answer() {
    controller.answer();
    if (who) navigate(`/work/${who.app}?focus=${who.id}`);
  }

  return (
    <div className="incoming-call" role="alertdialog" aria-live="assertive" aria-labelledby="incoming-call-name" aria-describedby="incoming-call-detail">
      <div className="incoming-call__label"><PhoneIncoming size={15} aria-hidden /> Incoming call</div>
      <div className="incoming-call__who">
        <div className="phone__avatar phone__avatar--ringing" aria-hidden>{(who && !who.adHoc ? who.name : '#').slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div id="incoming-call-name" className="incoming-call__name truncate">{name}</div>
          {who && !who.adHoc && <div className="mono incoming-call__number">{number}</div>}
          <div id="incoming-call-detail" className="incoming-call__detail truncate">{detail}</div>
        </div>
      </div>
      <div className="phone__actions">
        <button type="button" className="phone__big phone__big--end" aria-label="Decline" onClick={() => controller.hangup()}><PhoneOff size={26} /></button>
        <button type="button" className="phone__big phone__big--call" aria-label="Answer" autoFocus onClick={answer}><PhoneIcon size={26} /></button>
      </div>
    </div>
  );
}
