// Add a customer by hand: their mobile number is who they are. Adding a number that already exists opens that
// customer instead of making a second one, so every call to the same person lands on the same history.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import type { AppId, CustomerUser, Language } from '../../data/types';
import { ALL_LANGUAGES, can } from '../../lib/access';
import { DEFAULT_COUNTRY_CODE } from '../../lib/telephony';
import { directDialDigits } from '../../lib/directDial';
import { customerIdFor, findByMobile } from '../../lib/customers';
import { Button, Callout, Field, Input, Select, Textarea } from '../../ui/primitives';

export function AddCustomerDialog({ appId, onClose, onAdded, callLabel }: {
  /** The product to file them under; the person may change it when they work more than one. */
  appId?: AppId;
  onClose: () => void;
  /** Called with the saved customer. `call` is true when "Add and call" was chosen. */
  onAdded: (customer: CustomerUser, call: boolean) => void;
  /** Offer "Add and call" (agents with a phone line). */
  callLabel?: string;
}) {
  const { state, dispatch, currentAgent } = useStore();
  const me = currentAgent!;
  const products = APPS.filter((a) => a.live && (me.role === 'admin' || me.apps.includes(a.id)));
  const [app, setApp] = useState<AppId>(appId ?? products[0]?.id ?? 'realbroks');
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>(me.languages[0] ?? 'English');
  const [city, setCity] = useState('');
  const [business, setBusiness] = useState('');
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState<string>(me.role === 'agent' ? me.id : '');
  const [tried, setTried] = useState(false);

  const digits = directDialDigits(mobile, DEFAULT_COUNTRY_CODE);
  const existing = digits ? findByMobile(state.users, digits) : undefined;
  const duplicate = existing && !existing.adHoc && !existing.deleted ? existing : undefined;
  const errors = {
    mobile: !mobile.trim() ? 'Enter their mobile number.' : !digits || digits.length < 10 ? 'That doesn’t look like a mobile number.' : null,
    name: !name.trim() ? 'Enter their name.' : null,
  };
  const agents = state.agents.filter((a) => a.role === 'agent' && (a.status ?? 'active') === 'active' && a.apps.includes(app));
  const languages = [...me.languages, ...ALL_LANGUAGES.filter((l) => !me.languages.includes(l))];

  function submit(call: boolean) {
    setTried(true);
    if (errors.mobile || errors.name || duplicate || !digits) return;
    const now = Date.now();
    const details = {
      name: name.trim(),
      business: business.trim() || 'Customer',
      app,
      phone: `+${digits}`,
      city: city.trim() || '—',
      language,
      note: note.trim() || undefined,
      ownerAgentId: owner || null,
      manual: true,
      adHoc: false,
      queue: 'new' as const,
      stageTag: 'New',
    };
    let saved: CustomerUser;
    if (existing) {
      // They rang in or were dialled before being added: keep that record and its calls, and fill it in.
      // (A customer who was deleted comes back with the same history.)
      saved = { ...existing, ...details, deleted: null };
      dispatch({ type: 'UPDATE_CUSTOMER', userId: existing.id, patch: { ...details, deleted: null } });
    } else {
      saved = {
        id: customerIdFor(digits),
        shopCode: '',
        state: null,
        effectiveState: '—',
        registeredAtLabel: new Date(now).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        registeredDaysAgo: 0,
        plan: 'Free',
        listings: 0,
        buyers: 0,
        lastOpenLabel: '—',
        appVersion: '—',
        conversionScore: 0,
        attempt: 0,
        callHistory: [],
        tickets: [],
        paying: false,
        active: true,
        hasActiveEscalation: false,
        ...details,
      };
      dispatch({ type: 'ADD_CUSTOMER', customer: saved });
    }
    onAdded(saved, call);
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(!!callLabel && can(me, app, 'call'));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>Their mobile number is their ID — every call to it is kept on this one customer.</DialogDescription>
        </DialogHeader>
        <form className="stack" style={{ gap: 14 }} onSubmit={onSubmit}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Mobile number" htmlFor="ac-mobile" error={tried && errors.mobile}>
              <Input id="ac-mobile" inputMode="tel" autoFocus value={mobile} invalid={tried && !!errors.mobile} onChange={(e) => setMobile(e.target.value)} placeholder="98450 12345" />
            </Field>
            <Field label="Name" htmlFor="ac-name" error={tried && errors.name}>
              <Input id="ac-name" value={name} invalid={tried && !!errors.name} onChange={(e) => setName(e.target.value)} placeholder="Ramesh K" />
            </Field>
          </div>
          {duplicate && (
            <Callout tone="warn">
              This number is already <b>{duplicate.name}</b>{duplicate.app !== app ? ` (${APPS.find((a) => a.id === duplicate.app)?.name})` : ''}.{' '}
              <Link to={`/customers/${duplicate.id}`} onClick={onClose}>Open their page</Link>
            </Callout>
          )}
          {existing?.deleted && <Callout tone="accent">This number was deleted by {existing.deleted.byName}. Adding it brings the customer back with their calls.</Callout>}
          {existing?.adHoc && <Callout tone="accent">This number has called or been called before — those calls stay with the new customer.</Callout>}
          <div className="grid-2" style={{ gap: 12 }}>
            {products.length > 1 && (
              <Field label="Product" htmlFor="ac-app">
                <Select id="ac-app" value={app} onChange={(e) => setApp(e.target.value as AppId)}>
                  {products.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Language" htmlFor="ac-lang">
              <Select id="ac-lang" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="City (optional)" htmlFor="ac-city">
              <Input id="ac-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Coimbatore" />
            </Field>
            <Field label="Business (optional)" htmlFor="ac-biz">
              <Input id="ac-biz" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="Shop or company name" />
            </Field>
            {me.role !== 'agent' && (
              <Field label="Who calls them" htmlFor="ac-owner">
                <Select id="ac-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Any agent who speaks {language}</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <Field label="Note (optional)" htmlFor="ac-note">
            <Textarea id="ac-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where they came from, what they asked about" />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Cancel</Button>
            {callLabel && can(me, app, 'call') ? (
              <>
                <Button onClick={() => submit(false)}>Add only</Button>
                <Button type="submit" variant="primary">{callLabel}</Button>
              </>
            ) : (
              <Button type="submit" variant="primary">Add customer</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
