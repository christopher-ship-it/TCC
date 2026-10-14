import { useMemo, useState } from 'react';
import { Check, ShieldCheck, UserX, UserCheck, X } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { APPS, STATE_DEFS } from '../../data/seed';
import { QUEUES, type AgentAccount, type AppId, type Capability, type Language, type QueueKey, type Role } from '../../data/types';
import { ACCESS_TEMPLATES, ALL_LANGUAGES, CAPABILITIES, LANGUAGE_SCRIPT, ROLE_INFO, canManage, capsFor, describeScope, isActive } from '../../lib/access';
import { reachableCount } from '../../lib/queue';
import { fmtDayTime } from '../../lib/dates';
import { Avatar, Badge, Button, Callout, CheckBox, Chip, Field, Input, Sheet, Tabs, Toggle } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

type Section = 'who' | 'access' | 'reach' | 'line' | 'activity';

interface Draft {
  name: string;
  username: string;
  email: string;
  phone: string;
  role: Role;
  trainee: boolean;
  apps: AppId[];
  capabilities: Partial<Record<AppId, Capability[]>>;
  queues: QueueKey[];
  languages: Language[];
  states: string[];
  dailyTarget: number;
  clickToDial: boolean;
  telecmiUserId: string;
}

const appName = (id: AppId) => APPS.find((a) => a.id === id)?.name ?? id;
const queueLabel = (q: QueueKey) => QUEUES.find((x) => x.key === q)?.label ?? q;

function toDraft(a?: AgentAccount): Draft {
  if (!a) {
    const t = ACCESS_TEMPLATES[0];
    return { name: '', username: '', email: '', phone: '', role: t.role, trainee: !!t.trainee, apps: ['realbroks'], capabilities: { realbroks: t.caps }, queues: t.queues, languages: ['Tamil'], states: ['Tamil Nadu'], dailyTarget: t.dailyTarget, clickToDial: true, telecmiUserId: '' };
  }
  const caps: Partial<Record<AppId, Capability[]>> = {};
  for (const app of a.apps) caps[app] = capsFor(a, app);
  return { name: a.name, username: a.username, email: a.email ?? '', phone: a.phone ?? '', role: a.role, trainee: !!a.trainee, apps: a.apps, capabilities: caps, queues: a.queues, languages: a.languages, states: a.states, dailyTarget: a.dailyTarget, clickToDial: a.clickToDial, telecmiUserId: a.telecmiUserId ?? '' };
}

const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');

/** A human summary of what changed, for the change log. */
function diff(before: Draft, after: Draft): string[] {
  const out: string[] = [];
  if (before.name !== after.name) out.push(`Name: ${after.name}`);
  if (before.role !== after.role) out.push(`Role: ${ROLE_INFO[before.role].label} → ${ROLE_INFO[after.role].label}`);
  if (before.trainee !== after.trainee) out.push(after.trainee ? 'Marked trainee' : 'No longer a trainee');
  const addApps = after.apps.filter((x) => !before.apps.includes(x));
  const delApps = before.apps.filter((x) => !after.apps.includes(x));
  if (addApps.length) out.push(`Added to ${list(addApps.map(appName))}`);
  if (delApps.length) out.push(`Removed from ${list(delApps.map(appName))}`);
  for (const app of after.apps.filter((x) => before.apps.includes(x))) {
    const b = before.capabilities[app] ?? [];
    const c = after.capabilities[app] ?? [];
    const add = c.filter((x) => !b.includes(x));
    const del = b.filter((x) => !c.includes(x));
    const lab = (k: Capability) => CAPABILITIES.find((x) => x.key === k)!.label;
    if (add.length) out.push(`${appName(app)}: added ${list(add.map(lab))}`);
    if (del.length) out.push(`${appName(app)}: removed ${list(del.map(lab))}`);
  }
  if (before.queues.join() !== after.queues.join()) out.push(`Queues: ${list(after.queues.map(queueLabel))}`);
  if (before.languages.join() !== after.languages.join()) out.push(`Languages: ${list(after.languages)}`);
  if (before.states.join() !== after.states.join()) out.push(`States: ${after.states.length > 3 ? `${after.states.length} states` : list(after.states)}`);
  if (before.dailyTarget !== after.dailyTarget) out.push(`Daily target: ${after.dailyTarget}`);
  if (before.telecmiUserId !== after.telecmiUserId) out.push(`Phone line: ${after.telecmiUserId || 'none'}`);
  if (before.clickToDial !== after.clickToDial) out.push(after.clickToDial ? 'Browser calling on' : 'Browser calling off');
  return out;
}

export function PersonEditor({ person, onClose }: { person?: AgentAccount; onClose: () => void }) {
  const { state, dispatch, currentAgent, createAgent, backend } = useStore();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useToast();
  const actor = currentAgent!;
  const creating = !person;
  const editable = canManage(actor, person);
  const self = person?.id === actor.id;
  const [initial] = useState(() => toDraft(person));
  const [d, setD] = useState<Draft>(initial);
  const [section, setSection] = useState<Section>(creating ? 'who' : 'access');
  const [template, setTemplate] = useState(creating ? ACCESS_TEMPLATES[0].id : '');
  const [tried, setTried] = useState(false);
  const [userTouched, setUserTouched] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const roleChoices: Role[] = actor.role === 'admin' ? ['agent', 'supervisor', 'admin'] : ['agent'];
  const templates = ACCESS_TEMPLATES.filter((t) => roleChoices.includes(t.role));
  const liveApps = APPS.filter((a) => a.live || d.role === 'admin');
  const changes = creating ? [] : diff(initial, d);
  const scope = describeScope(d, appName, queueLabel);
  const reach = reachableCount(d, state.users);
  const usernameTaken = state.agents.some((a) => a.username.toLowerCase() === d.username.trim().toLowerCase() && a.id !== person?.id);
  const errors = {
    name: !d.name.trim() ? 'Enter their name.' : null,
    username: !/^[a-z0-9._-]{3,}$/.test(d.username.trim()) ? 'Use 3+ lowercase letters, numbers, dots or dashes.' : usernameTaken ? 'Someone already has this username.' : null,
    apps: d.role !== 'admin' && d.apps.length === 0 ? 'Give them at least one app.' : null,
    email: creating && backend === 'firestore' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()) ? 'Enter their work email — they sign in with it.' : null,
  };
  const valid = !errors.name && !errors.username && !errors.apps && !errors.email;
  const activity = useMemo(() => (person ? state.audit.filter((e) => e.target === person.name || e.actorId === person.id).slice(0, 40) : []), [state.audit, person]);

  function applyTemplate(id: string) {
    const t = ACCESS_TEMPLATES.find((x) => x.id === id)!;
    setTemplate(id);
    setD((x) => {
      const apps = t.role === 'admin' ? APPS.map((a) => a.id) : x.apps.length ? x.apps : ['realbroks' as AppId];
      const caps: Partial<Record<AppId, Capability[]>> = {};
      for (const app of apps) caps[app] = t.caps;
      return { ...x, role: t.role, trainee: !!t.trainee, queues: t.queues, capabilities: caps, apps, dailyTarget: t.dailyTarget };
    });
  }

  function toggleApp(app: AppId) {
    setD((x) => {
      const on = x.apps.includes(app);
      const apps = on ? x.apps.filter((a) => a !== app) : [...x.apps, app];
      const capabilities = { ...x.capabilities };
      if (on) delete capabilities[app];
      else capabilities[app] = ACCESS_TEMPLATES.find((t) => t.id === template)?.caps ?? ['call', 'tickets', 'recordings'];
      return { ...x, apps, capabilities };
    });
  }

  function toggleCap(app: AppId, cap: Capability) {
    setD((x) => {
      const cur = x.capabilities[app] ?? [];
      return { ...x, capabilities: { ...x.capabilities, [app]: cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap] } };
    });
  }

  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  function save() {
    setTried(true);
    if (!valid) {
      setSection(errors.name || errors.username || errors.email ? 'who' : 'access');
      return;
    }
    const patch: Partial<AgentAccount> = {
      name: d.name.trim(),
      username: d.username.trim().toLowerCase(),
      ...(creating && d.email.trim() ? { email: d.email.trim().toLowerCase() } : {}),
      phone: d.phone.trim() || undefined,
      role: d.role,
      trainee: d.trainee || undefined,
      apps: d.role === 'admin' ? APPS.map((a) => a.id) : d.apps,
      capabilities: d.role === 'admin' ? undefined : d.capabilities,
      queues: d.role === 'admin' ? [] : d.queues,
      languages: d.languages,
      states: d.states,
      dailyTarget: d.dailyTarget,
      clickToDial: d.clickToDial,
      telecmiUserId: d.telecmiUserId.trim() || undefined,
    };
    if (creating) {
      const id = `${patch.username!.replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36).slice(-4)}`;
      setSaving(true);
      setSaveError(null);
      createAgent(
        {
          id,
          ...(patch as Omit<AgentAccount, 'id'>),
          status: 'active',
          createdTs: Date.now(),
          lastActiveLabel: 'Never',
          todayCalls: 0,
          todayConnected: 0,
          todayPositive: 0,
          todaySubscribed: 0,
          todayOverdue: 0,
          avgHandleLabel: '—',
          workingQueueLabel: '—',
        },
        actor.id,
      ).then((r) => {
        setSaving(false);
        if (!r.ok) {
          setSaveError(r.message);
          setSection('who');
          return;
        }
        toast(backend === 'firestore' ? `${patch.name} was emailed a link to choose a password` : `${patch.name} can now sign in as ${patch.username}`);
        onClose();
      });
      return;
    } else {
      if (!changes.length) return onClose();
      dispatch({ type: 'UPDATE_AGENT', agentId: person!.id, patch, actorId: actor.id, detail: changes.join(' · ') });
      toast(`Access saved for ${patch.name}`);
    }
    onClose();
  }

  function setStatus(active: boolean) {
    if (!person) return;
    dispatch({ type: 'UPDATE_AGENT', agentId: person.id, patch: { status: active ? 'active' : 'suspended' }, actorId: actor.id, detail: active ? 'Reactivated — can sign in again' : 'Suspended — can no longer sign in', auditAction: active ? 'user_reactivated' : 'user_suspended' });
    toast(active ? `${person.name} reactivated` : `${person.name} suspended`);
    onClose();
  }

  const sections: { value: Section; label: string }[] = [
    { value: 'who', label: creating ? '1 · Who' : 'Details' },
    { value: 'access', label: creating ? '2 · Apps & permissions' : 'Apps & permissions' },
    { value: 'reach', label: creating ? '3 · Languages & states' : 'Languages & states' },
    { value: 'line', label: creating ? '4 · Phone line' : 'Phone line' },
    ...(creating ? [] : [{ value: 'activity' as Section, label: 'Activity' }]),
  ];
  const order: Section[] = ['who', 'access', 'reach', 'line'];
  const stepIndex = order.indexOf(section);

  return (
    <Sheet
      wide
      title={creating ? 'Add a person' : person!.name}
      desc={creating ? (backend === 'firestore' ? 'They sign in with their work email and choose their own password.' : 'They sign in with the username you set here.') : `${person!.username} · ${ROLE_INFO[person!.role].label}${person!.createdTs ? ` · added ${fmtDayTime(person!.createdTs).split(' · ')[0]}` : ''}`}
      leading={!creating ? <Avatar name={person!.name} size="lg" /> : undefined}
      onClose={onClose}
      footer={
        <>
          {!creating && editable && !self && (isActive(person!) ? <Button variant="danger-outline" icon={<UserX size={15} />} onClick={() => setStatus(false)}>Suspend</Button> : <Button icon={<UserCheck size={15} />} onClick={() => setStatus(true)}>Reactivate</Button>)}
          <span className="muted" style={{ fontSize: 13, marginLeft: 'auto' }}>{creating ? '' : changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} · written to the change log` : 'No changes'}</span>
          {creating && stepIndex > 0 && <Button onClick={() => setSection(order[stepIndex - 1])}>Back</Button>}
          {creating && stepIndex < order.length - 1 ? (
            <Button variant="primary" onClick={() => setSection(order[stepIndex + 1])}>Continue</Button>
          ) : (
            editable && section !== 'activity' && <Button variant="primary" icon={<Check size={15} />} onClick={save} disabled={saving || (!creating && !changes.length)}>{saving ? 'Adding…' : creating ? 'Add person' : 'Save access'}</Button>
          )}
        </>
      }
    >
      {!editable && <Callout tone="accent" icon={<ShieldCheck size={16} />}>You can see {person?.name}’s access but only an admin can change a {ROLE_INFO[person!.role].label.toLowerCase()}.</Callout>}
      {!creating && !isActive(person!) && <Callout tone="danger">Suspended — this person cannot sign in.</Callout>}
      <Tabs label="Sections" value={section} onChange={setSection} tabs={sections} />

      <div className="person-grid">
        <fieldset disabled={!editable} className="stack" style={{ gap: 18, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {section === 'who' && (
            <>
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label="Full name" htmlFor="pe-name" error={tried && errors.name}>
                  <Input id="pe-name" value={d.name} invalid={tried && !!errors.name} onChange={(e) => {
                    const name = e.target.value;
                    set('name', name);
                    if (creating && !userTouched) {
                      const [first = '', ...rest] = name.trim().toLowerCase().split(/\s+/);
                      set('username', [first.replace(/[^a-z0-9]/g, ''), (rest.pop() ?? '').replace(/[^a-z0-9]/g, '').slice(0, 1)].filter(Boolean).join('.'));
                    }
                  }} placeholder="Kavya R" />
                </Field>
                <Field label="Username" htmlFor="pe-user" error={tried && errors.username} hint="What they type to sign in.">
                  <Input id="pe-user" value={d.username} invalid={tried && !!errors.username} onChange={(e) => { setUserTouched(true); set('username', e.target.value.toLowerCase()); }} placeholder="kavya.r" />
                </Field>
                {saveError && <Callout tone="danger">{saveError}</Callout>}
                {(creating ? backend === 'firestore' : !!person?.email) && (
                  <Field label="Work email" htmlFor="pe-email" error={tried && errors.email} hint={creating ? 'Their login. They get an email to choose a password.' : undefined}>
                    <Input id="pe-email" type="email" value={d.email} readOnly={!creating} invalid={tried && !!errors.email} onChange={(e) => set('email', e.target.value)} placeholder="kavya@tecstellar.com" />
                  </Field>
                )}
                <Field label="Mobile (optional)" htmlFor="pe-phone">
                  <Input id="pe-phone" value={d.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" placeholder="+91 98450 12345" />
                </Field>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <span className="section-label">Start from a template</span>
                <div className="row">
                  {templates.map((t) => (
                    <Chip key={t.id} pressed={template === t.id} onClick={() => applyTemplate(t.id)} title={t.help}>{t.label}</Chip>
                  ))}
                </div>
                {template && <span className="muted" style={{ fontSize: 13 }}>{ACCESS_TEMPLATES.find((t) => t.id === template)?.help}</span>}
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <span className="section-label">Role</span>
                <div className="role-cards">
                  {roleChoices.map((r) => (
                    <button key={r} type="button" className="role-card" aria-pressed={d.role === r} disabled={self} onClick={() => { set('role', r); setTemplate(''); if (r === 'admin') set('apps', APPS.map((a) => a.id)); }}>
                      <b>{ROLE_INFO[r].label}</b>
                      <span>{ROLE_INFO[r].help}</span>
                    </button>
                  ))}
                </div>
              </div>
              {d.role === 'agent' && <Toggle checked={d.trainee} onChange={(v) => set('trainee', v)} label="Trainee" help="Supervisors see a trainee badge and review their calls first." />}
            </>
          )}

          {section === 'access' && (
            d.role === 'admin' ? (
              <Callout tone="accent">Admins can do everything in every app, including changing people’s access.</Callout>
            ) : (
              <>
                <div className="stack" style={{ gap: 8 }}>
                  <span className="section-label">Apps and what they may do in each</span>
                  {tried && errors.apps && <span className="field__error">{errors.apps}</span>}
                  <div className="tbl-wrap">
                    <table className="tbl perm-table">
                      <thead>
                        <tr>
                          <th>App</th>
                          {CAPABILITIES.map((c) => <th key={c.key} title={`${c.label} — ${c.help}`}>{c.short}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {liveApps.map((a) => {
                          const on = d.apps.includes(a.id);
                          return (
                            <tr key={a.id}>
                              <td>
                                <label className="row" style={{ gap: 10, flexWrap: 'nowrap', cursor: 'pointer' }}>
                                  <CheckBox checked={on} onChange={() => toggleApp(a.id)} label={`Give access to ${a.name}`} />
                                  <span style={{ fontWeight: 500 }}>{a.name}</span>
                                </label>
                              </td>
                              {CAPABILITIES.map((c) => (
                                <td key={c.key} style={{ textAlign: 'center' }}>
                                  <CheckBox checked={on && (d.capabilities[a.id] ?? []).includes(c.key)} disabled={!on} onChange={() => toggleCap(a.id, c.key)} label={`${a.name}: ${c.label}`} />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>Influnet and Vehigo appear here when they go live.</span>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  <span className="section-label">Queues they work</span>
                  <div className="row">
                    {QUEUES.map((q) => <Chip key={q.key} pressed={d.queues.includes(q.key)} onClick={() => set('queues', toggleIn(d.queues, q.key))}>{q.label}</Chip>)}
                  </div>
                </div>
              </>
            )
          )}

          {section === 'reach' && (
            <>
              <div className="stack" style={{ gap: 8 }}>
                <span className="section-label">Languages they speak</span>
                <div className="lang-grid">
                  {ALL_LANGUAGES.map((l) => (
                    <button key={l} type="button" className="lang-card" aria-pressed={d.languages.includes(l)} onClick={() => set('languages', toggleIn(d.languages, l))}>
                      <b>{LANGUAGE_SCRIPT[l]}</b>
                      <span>{l}</span>
                    </button>
                  ))}
                </div>
                <span className="muted" style={{ fontSize: 13 }}>Customers are matched by language first. Customers with no state on file count as Tamil Nadu.</span>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="section-label">States they cover</span>
                  <Button size="sm" variant="ghost" onClick={() => set('states', STATE_DEFS.filter((s) => d.languages.includes(s.language) || s.name === 'Tamil Nadu').map((s) => s.name))}>Match their languages</Button>
                </div>
                <div className="row">
                  {STATE_DEFS.map((s) => (
                    <Chip key={s.name} pressed={d.states.includes(s.name)} onClick={() => set('states', toggleIn(d.states, s.name))} title={`Usually ${s.language}`}>
                      {s.name}
                      {!d.languages.includes(s.language) && d.states.includes(s.name) && <span style={{ color: 'var(--warn)', fontSize: 12 }}>· no {s.language}</span>}
                    </Chip>
                  ))}
                </div>
              </div>
            </>
          )}

          {section === 'line' && (
            <>
              <Toggle checked={d.clickToDial} onChange={(v) => set('clickToDial', v)} label="Call from the browser" help="Uses their TeleCMI line. Off: they dial from their own mobile and log the call here." />
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label="TeleCMI user ID" htmlFor="pe-cmi" hint="From TeleCMI › Users. They type their own password when the line connects — it is never stored here.">
                  <Input id="pe-cmi" value={d.telecmiUserId} onChange={(e) => set('telecmiUserId', e.target.value)} placeholder="5006_33338836" />
                </Field>
                <Field label="Daily call target" htmlFor="pe-target">
                  <Input id="pe-target" type="number" min={0} max={300} value={d.dailyTarget} onChange={(e) => set('dailyTarget', Math.max(0, Number(e.target.value) || 0))} />
                </Field>
              </div>
            </>
          )}

          {section === 'activity' && (
            activity.length === 0 ? (
              <span className="muted">Nothing logged yet.</span>
            ) : (
              <ol className="audit-mini">
                {activity.map((e) => (
                  <li key={e.id}>
                    <span className="mono muted">{fmtDayTime(e.ts)}</span>
                    <span><b>{e.actorName}</b> {e.detail}{e.target && e.target !== person?.name ? ` — ${e.target}` : ''}</span>
                  </li>
                ))}
              </ol>
            )
          )}
        </fieldset>

        <aside className="scope-card" aria-label="What they will be able to do">
          <span className="section-label">{d.name.trim() ? `${d.name.trim().split(' ')[0]} will be able to` : 'They will be able to'}</span>
          <ul>
            {scope.can.map((s) => <li key={s}><Check size={15} color="var(--ok)" />{s}</li>)}
          </ul>
          {scope.cannot.length > 0 && (
            <>
              <span className="section-label">Won’t be able to</span>
              <ul>{scope.cannot.map((s) => <li key={s} className="muted"><X size={15} />{s}</li>)}</ul>
            </>
          )}
          {d.role !== 'admin' && (
            <div className="scope-card__reach">
              <span className="mono">{reach.toLocaleString('en-IN')}</span>
              <span className="muted">customers waiting in queues they could reach right now</span>
            </div>
          )}
          {d.trainee && <Badge tone="accent">Trainee</Badge>}
        </aside>
      </div>
    </Sheet>
  );
}
