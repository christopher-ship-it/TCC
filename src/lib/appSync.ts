// Customers from a product's own database, through the TCC Data API each product exposes (docs/client-api-guide),
// turned into TCC customers and laid over the ones TCC already has.
//
// Who owns what:
//  - The product owns the profile (name, shop, city, registered, orders, last opened …). Once a customer is linked
//    (`sync` is set) every sync rewrites it, and a browser can't overwrite it with an older copy (server/store.ts).
//  - The plan is shared: TCC takes the product's plan when it first links a customer and whenever the product's
//    plan changes, so an agent's "mark paid" stands until the product says otherwise.
//  - TCC owns everything its people do: calls, notes, owner, follow-ups, positive/negative, customer type, language.
//    The queue and stage tag come from the product only while nobody in TCC has worked the customer yet.
import type { AppId, CustomerUser, DetailField, Language, PaymentDue, QueueKey, SourceLink, TicketRecord } from '../data/types.ts';
import { customerTypesFor } from '../data/products.ts';
import { TECSTELLAR_STATES } from '../data/states.ts';
import { customerLanguageFrom, languageForState } from './languages.ts';
import { normalizePhone } from '../telephony/core/phone-number.ts';

const DAY_MS = 86_400_000;

/** One customer as the TCC Data API sends it (guide, section 4). */
export interface SourceCustomer {
  id: string;
  app: string;
  name: string | null;
  phone: string | null;
  alt_phone?: string | null;
  email?: string | null;
  business_name?: string | null;
  customer_type?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  preferred_language?: string | null;
  registered_at?: string | null;
  last_active_at?: string | null;
  app_version?: string | null;
  platform?: string | null;
  acquisition_source?: string | null;
  onboarding?: { stage?: string | null; completed?: boolean | null; last_error?: { code: string; message: string; at: string } | null } | null;
  usage?: { primary_count?: number | null; secondary_count?: number | null; last_action_at?: string | null } | null;
  plan?: { name?: string | null; is_paid?: boolean | null; started_at?: string | null; renews_at?: string | null; monthly_value?: { amount: number; currency: string } | null } | null;
  payment_due?: { amount?: { amount: number; currency: string } | null; due_date?: string | null; status?: 'upcoming' | 'overdue' | 'expired' | null } | null;
  open_tickets?: { id: string; subject: string; status: string; created_at: string; sla_breached: boolean }[] | null;
  account_status: 'active' | 'blocked' | 'deleted';
  updated_at: string;
  deleted_at?: string | null;
}

/** GET /meta: what the product calls its setup steps. */
export interface SourceMeta {
  app: string;
  app_name?: string;
  onboarding_stages?: { stage: string; label: string }[];
  total_customers?: number;
}

/** The profile fields the product owns once a customer is linked. */
export const SOURCE_PROFILE_FIELDS = [
  'name', 'business', 'city', 'state', 'effectiveState', 'registeredAtLabel', 'registeredDaysAgo', 'listings', 'buyers', 'lastOpenLabel', 'appVersion', 'active',
] as const satisfies readonly (keyof CustomerUser)[];

/** The plan fields TCC takes from the product only when the product's plan changes. */
export const SOURCE_PLAN_FIELDS = ['plan', 'paying', 'planNote'] as const satisfies readonly (keyof CustomerUser)[];

/** Tickets that came from the product, as opposed to ones an agent raised in TCC. */
const SOURCE_TICKET_PREFIX = 'src-';

/** States agents aren't set up for, routed to the nearest one they are (an agent's states come from TECSTELLAR_STATES). */
const NEAREST_STATE: Record<string, string> = {
  Puducherry: 'Tamil Nadu', 'Andaman and Nicobar Islands': 'Tamil Nadu', Lakshadweep: 'Kerala', Goa: 'Maharashtra',
  'Dadra and Nagar Haveli and Daman and Diu': 'Gujarat', Haryana: 'Delhi', Punjab: 'Delhi', Chandigarh: 'Delhi',
  'Himachal Pradesh': 'Delhi', Uttarakhand: 'Delhi', 'Jammu and Kashmir': 'Delhi', Ladakh: 'Delhi', Bihar: 'Uttar Pradesh',
  Jharkhand: 'West Bengal', Odisha: 'West Bengal', Chhattisgarh: 'Madhya Pradesh', Assam: 'West Bengal', Sikkim: 'West Bengal',
  Meghalaya: 'West Bengal', Tripura: 'West Bengal', Manipur: 'West Bengal', Mizoram: 'West Bengal', Nagaland: 'West Bengal',
  'Arunachal Pradesh': 'West Bengal',
};
const HOME_STATE = 'Tamil Nadu';

const tail = (phone: string) => phone.replace(/\D/g, '').slice(-10);

const ts = (v: string | null | undefined): number | null => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

const IST = 'Asia/Kolkata';
const dayLabel = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
const dayTimeLabel = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: IST });

const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Where an agent can pick the customer up: the state if agents work it, else the nearest one that they do. */
function placeOf(rawState: string | null): { state: string | null; effectiveState: string; stateLanguage: Language } {
  const listed = TECSTELLAR_STATES.find((s) => s.name === rawState);
  const effective = listed ?? TECSTELLAR_STATES.find((s) => s.name === (rawState && NEAREST_STATE[rawState])) ?? TECSTELLAR_STATES.find((s) => s.name === HOME_STATE)!;
  // The team's rule decides the language, even for a state agents are not set up for (Goa and Lakshadweep call in Hindi).
  return { state: listed ? listed.name : null, effectiveState: effective.name, stateLanguage: rawState ? languageForState(rawState) : effective.language };
}

/** A language the customer chose in the app beats the state's; English is not a reason to call in English. */
function languageOf(preferred: string | null | undefined, stateLanguage: Language): Language {
  return customerLanguageFrom(preferred) ?? stateLanguage;
}

/** Which call list the product's data puts a customer in. Most urgent first; one list per customer. */
export function sourceQueue(src: SourceCustomer, now: number): QueueKey | null {
  if (src.account_status !== 'active') return null;
  if (src.open_tickets?.length) return 'tickets';
  const due = src.payment_due;
  if (due?.status && (due.status !== 'upcoming' || (ts(due.due_date) ?? Infinity) - now <= 7 * DAY_MS)) return 'payments';
  const registered = ts(src.registered_at);
  const done = src.onboarding?.completed === true;
  if (registered !== null && now - registered <= 7 * DAY_MS && !done) return 'new';
  if (src.onboarding?.last_error) return 'errors';
  const lastActive = ts(src.last_active_at);
  if (lastActive !== null && now - lastActive > 30 * DAY_MS) return 'inactive';
  // Signed up more than a week ago and still short of the useful part: a drop-off.
  if (src.onboarding?.completed === false) return 'errors';
  return null;
}

function stageLabelOf(src: SourceCustomer, meta: SourceMeta | undefined): string | null {
  const stage = clean(src.onboarding?.stage);
  if (!stage) return null;
  return meta?.onboarding_stages?.find((s) => s.stage === stage)?.label ?? stage.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function planOf(src: SourceCustomer): SourceLink['plan'] {
  const paid = src.plan?.is_paid === true;
  const name = clean(src.plan?.name);
  const renews = ts(src.plan?.renews_at);
  const note = [paid && name ? name : null, paid && renews ? `renews ${dayLabel(renews)}` : null].filter(Boolean).join(' · ');
  return { plan: paid ? 'Paid' : 'Free', paying: paid, ...(note ? { planNote: note } : {}) };
}

function ticketsOf(src: SourceCustomer): TicketRecord[] {
  return (src.open_tickets ?? []).slice(0, 5).map((t) => ({ id: `${SOURCE_TICKET_PREFIX}${t.id}`, subject: t.subject, raisedAtLabel: dayLabel(ts(t.created_at) ?? Date.now()), slaBreached: Boolean(t.sla_breached) }));
}

function paymentDueOf(src: SourceCustomer): PaymentDue | undefined {
  const d = src.payment_due;
  if (!d?.status) return undefined;
  const due = ts(d.due_date);
  return { amount: d.amount?.amount ?? 0, dueLabel: due ? dayLabel(due) : '—', status: d.status };
}

/** Nobody in TCC has worked this customer yet, so the product's data may still decide their queue. */
export function untouched(u: CustomerUser): boolean {
  return (
    !u.manual && !u.adHoc && !u.deleted && !u.callback && !u.followUp && !u.autoFollowUp && !u.hasActiveEscalation &&
    (u.callHistory ?? []).length === 0 && (u.tickets ?? []).every((t) => t.id.startsWith(SOURCE_TICKET_PREFIX))
  );
}

export type SkipReason = 'no-phone' | 'other-product' | 'closed';

/** The source's E.164 digits for a customer, or null when they have no usable number. */
export const sourceDigits = (src: SourceCustomer): string | null => normalizePhone(src.phone ?? '');

/**
 * The TCC customer for a source record, laid over `existing` (the customer TCC already has on that number, if any).
 * `existing` is found by the caller on the last 10 digits of the phone; a customer of another product is never taken over.
 */
export function applySource(
  existing: CustomerUser | undefined,
  src: SourceCustomer,
  app: AppId,
  meta: SourceMeta | undefined,
  now = Date.now(),
): { customer: CustomerUser } | { skip: SkipReason } {
  const digits = sourceDigits(src);
  if (!digits || digits.length < 10) return { skip: 'no-phone' };
  if (existing && !existing.adHoc && existing.app !== app) return { skip: 'other-product' };
  const open = src.account_status === 'active';
  if (!existing && !open) return { skip: 'closed' };

  const { state, effectiveState, stateLanguage } = placeOf(clean(src.state));
  const registered = ts(src.registered_at);
  const lastActive = ts(src.last_active_at);
  // No sign-up date on record: the earliest thing we know they did is the best guess at how long they've been around.
  const since = registered ?? [lastActive, ts(src.usage?.last_action_at)].filter((t): t is number => t !== null).sort((a, b) => a - b)[0] ?? now;
  const business = clean(src.business_name);
  const plan = planOf(src);
  const missing = (['name', 'business', 'city'] as const).filter((f) => !clean(f === 'name' ? src.name : f === 'business' ? src.business_name : src.city));
  // What an agent typed in stays while the product still has nothing for that detail.
  const typed = (existing?.filledIn?.fields ?? []).filter((f) => missing.includes(f));

  const profile: Pick<CustomerUser, (typeof SOURCE_PROFILE_FIELDS)[number]> = {
    name: clean(src.name) ?? (typed.includes('name') ? existing!.name : business ?? existing?.name ?? `+${digits}`),
    business: business ?? (existing && !existing.adHoc ? existing.business : 'Customer'),
    city: clean(src.city) ?? (existing && !existing.adHoc ? existing.city : '—'),
    state,
    effectiveState,
    registeredAtLabel: registered ? dayLabel(registered) : 'Not recorded',
    registeredDaysAgo: Math.max(0, Math.floor((now - since) / DAY_MS)),
    listings: src.usage?.primary_count ?? 0,
    buyers: src.usage?.secondary_count ?? 0,
    lastOpenLabel: lastActive ? dayTimeLabel(lastActive) : 'Not yet opened',
    appVersion: clean(src.app_version) ?? '—',
    active: open,
  };

  const link: SourceLink = {
    sourceId: String(src.id),
    syncedAt: now,
    accountStatus: src.account_status,
    stage: clean(src.onboarding?.stage),
    stageLabel: stageLabelOf(src, meta),
    onboardingCompleted: src.onboarding?.completed ?? null,
    lastError: src.onboarding?.last_error ?? null,
    registeredTs: registered,
    lastActiveTs: lastActive,
    platform: clean(src.platform),
    email: clean(src.email),
    planName: clean(src.plan?.name),
    renewsTs: ts(src.plan?.renews_at),
    missing,
    plan,
  };

  const base: CustomerUser = existing ?? {
    id: `cust-${digits}`,
    shopCode: String(src.id),
    name: profile.name,
    business: profile.business,
    app,
    phone: `+${digits}`,
    city: profile.city,
    state,
    effectiveState,
    language: stateLanguage,
    registeredAtLabel: profile.registeredAtLabel,
    registeredDaysAgo: profile.registeredDaysAgo,
    plan: 'Free',
    listings: 0,
    buyers: 0,
    lastOpenLabel: profile.lastOpenLabel,
    appVersion: profile.appVersion,
    conversionScore: 50,
    stageTag: 'New',
    queue: null,
    attempt: 0,
    callHistory: [],
    tickets: [],
    paying: false,
    active: true,
    hasActiveEscalation: false,
    ownerAgentId: null,
  };

  const next: CustomerUser = { ...base, ...profile, app, adHoc: false, sync: link };
  // Once the product sends a detail an agent filled in, the product's wins and the note of who typed it goes.
  if (existing?.filledIn) {
    if (typed.length) next.filledIn = { ...existing.filledIn, fields: typed };
    else delete next.filledIn;
  }
  // A dialled-in or incoming-call record becomes the real customer: it keeps its calls, and gets a proper language.
  if (!existing || existing.adHoc) next.language = languageOf(src.preferred_language, stateLanguage);
  const planChanged = !existing?.sync || SOURCE_PLAN_FIELDS.some((f) => existing.sync!.plan[f] !== plan[f]);
  if (planChanged) {
    next.plan = plan.plan;
    next.paying = plan.paying;
    if (plan.planNote) next.planNote = plan.planNote;
    else delete next.planNote;
  }
  const type = clean(src.customer_type);
  if (type && !next.customerType) next.customerType = customerTypesFor(app).find((t) => t.toLowerCase() === type.toLowerCase());
  if (!next.customerType) delete next.customerType;

  const label = !open ? 'Account closed' : link.stageLabel ?? 'Signed up';
  if (!existing || untouched(existing)) {
    next.queue = sourceQueue(src, now);
    next.stageTag = plan.paying && open ? 'Paying' : label;
    next.tickets = ticketsOf(src);
    const due = paymentDueOf(src);
    if (due) next.paymentDue = due;
    else delete next.paymentDue;
  } else if (existing.adHoc) {
    next.stageTag = label;
  }
  return { customer: next };
}

/** Whether a sync changed anything worth sending to every browser (the sync time alone isn't). */
export function sameCustomer(a: CustomerUser | undefined, b: CustomerUser): boolean {
  if (!a) return false;
  // Postgres (jsonb) hands records back with their keys in its own order, so compare with keys sorted.
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const strip = (u: CustomerUser) => JSON.stringify(canon({ ...u, sync: u.sync ? { ...u.sync, syncedAt: 0 } : undefined }));
  return strip(a) === strip(b);
}

/** Of several source accounts on one number, the one TCC follows: an open account, then the most recently used. */
export function pickPerNumber(rows: SourceCustomer[]): Map<string, SourceCustomer> {
  const best = new Map<string, SourceCustomer>();
  const score = (r: SourceCustomer) => [r.account_status === 'active' ? 1 : 0, ts(r.last_active_at) ?? 0] as const;
  for (const r of rows) {
    const digits = sourceDigits(r);
    if (!digits) continue;
    const key = tail(digits);
    const cur = best.get(key);
    if (!cur) { best.set(key, r); continue; }
    const [a1, a2] = score(r);
    const [b1, b2] = score(cur);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) best.set(key, r);
  }
  return best;
}

/**
 * A browser saving a linked customer from an older copy must not undo what the sync wrote. Profile fields always come
 * from the stored record (agents can't edit them); the plan, queue and stage come from it too unless the browser
 * actually changed them.
 */
export function keepSourceFields(stored: CustomerUser, incoming: CustomerUser): CustomerUser {
  if (!stored.sync) return incoming;
  const out: CustomerUser = { ...incoming };
  const put = <K extends keyof CustomerUser>(k: K) => {
    if (stored[k] === undefined) delete out[k];
    else out[k] = stored[k];
  };
  for (const f of SOURCE_PROFILE_FIELDS) put(f);
  // Except the details the product has none of: there an agent's latest entry stands, filled in or cleared (fillDetails).
  // A browser that never touched them sends no newer `filledIn`, so it can't undo someone else's entry.
  const typed = incoming.filledIn;
  if (typed && typed.ts >= (stored.filledIn?.ts ?? 0)) {
    const open = editableDetails(stored);
    for (const f of open) if (typed.fields.includes(f) || stored.filledIn?.fields.includes(f)) out[f] = incoming[f];
  } else if (stored.filledIn) out.filledIn = stored.filledIn;
  else delete out.filledIn;
  if ((incoming.sync?.syncedAt ?? 0) < stored.sync.syncedAt) {
    const seen = incoming.sync?.plan;
    if (!seen || SOURCE_PLAN_FIELDS.every((f) => incoming[f] === seen[f])) for (const f of SOURCE_PLAN_FIELDS) put(f);
    if (untouched(incoming) && untouched(stored)) for (const f of ['queue', 'stageTag', 'tickets', 'paymentDue'] as const) put(f);
  }
  out.sync = stored.sync;
  return out;
}

const PHONE_ONLY = /^\+?[\d\s-]{7,}$/;

/** True when TCC knows nothing but the customer's number: the product has no name or shop for them, and no one has added one. */
export const nameUnknown = (u: Pick<CustomerUser, 'name' | 'sync'>): boolean => !!u.sync && PHONE_ONLY.test(u.name.trim());

/**
 * The details an agent may fill in for a synced customer: the ones the product had empty at the last sync, plus any an
 * agent already filled. (Customers synced before `missing` was recorded: judged by the placeholders the sync left.)
 */
export function editableDetails(u: Pick<CustomerUser, 'name' | 'business' | 'city' | 'sync' | 'filledIn'>): DetailField[] {
  if (!u.sync) return [];
  const missing = u.sync.missing ?? (['name', 'business', 'city'] as const).filter((f) => (f === 'name' ? PHONE_ONLY.test(u.name.trim()) : f === 'business' ? u.business === 'Customer' : u.city === '—'));
  return (['name', 'business', 'city'] as const).filter((f) => missing.includes(f) || u.filledIn?.fields.includes(f));
}

/**
 * The change that saves an agent's entries for a customer's missing details. An empty entry puts the placeholder back.
 * With only a shop name, the shop stands in as the name (as it does when the product sends a shop and no name).
 */
export function fillDetails(u: CustomerUser, entry: Partial<Record<DetailField, string>>, byName: string, now = Date.now()): Partial<CustomerUser> {
  const open = editableDetails(u);
  const fields = new Set(u.filledIn?.fields ?? []);
  const patch: Partial<CustomerUser> = {};
  const placeholder: Record<DetailField, string> = { name: u.phone, business: 'Customer', city: '—' };
  for (const f of open) {
    if (entry[f] === undefined) continue;
    const v = entry[f]!.trim().replace(/\s+/g, ' ').slice(0, 120);
    patch[f] = v || placeholder[f];
    if (v) fields.add(f);
    else fields.delete(f);
  }
  if (!fields.has('name') && open.includes('name') && fields.has('business') && PHONE_ONLY.test((patch.name ?? u.name).trim())) {
    patch.name = patch.business ?? u.business;
    fields.add('name');
  }
  // Always set, even with nothing left filled in: an empty list is how a cleared entry reaches the server.
  patch.filledIn = { fields: (['name', 'business', 'city'] as const).filter((f) => fields.has(f)), byName, ts: now };
  return patch;
}

/** "Ravi Ironing · Coimbatore, Tamil Nadu", leaving out the placeholders the sync uses for details the product lacks. */
export const placeLine = (u: Pick<CustomerUser, 'business' | 'city' | 'effectiveState'>): string =>
  [u.business !== 'Customer' && u.business, [u.city !== '—' && u.city, u.effectiveState].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

export { tail as phoneTail };
