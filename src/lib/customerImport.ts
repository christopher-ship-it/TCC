// Turns a CSV export of real customers (RealBroks / IronDrobe, or whatever comes next) into the
// CustomerUser records the rest of the app expects, in place of the generated sample set
// (src/data/seed.ts). Excel: "Save As" → CSV UTF-8 before uploading.
import { normalizePhone } from '../telephony/core/phone-number.ts';
import type { AppId, CustomerUser, Language } from '../data/types.ts';
import { customerLanguageFrom, languageForState } from './languages.ts';
import { customerTypesFor } from '../data/products.ts';

export const CUSTOMER_CSV_COLUMNS = [
  'app', 'name', 'phone', 'business', 'city', 'state', 'plan', 'listings', 'buyers', 'registered_at', 'language', 'owner_agent_id',
] as const;

const APP_IDS: AppId[] = ['realbroks', 'irondrobe', 'influnet', 'vehigo', 'vanmoh'];

/** Just enough of src/data/seed.ts's StateDef to validate and default from — callers pass the real STATE_DEFS. */
export interface StateCatalogEntry {
  name: string;
  language: Language;
  cities: string[];
}

/** `example` is one sample row; a white-label build passes its own (src/brand). */
export function customerCsvTemplate(example = 'realbroks,Suresh Kumar,9876543210,Suresh Properties,Chennai,Tamil Nadu,Free,0,0,2026-01-15,Tamil,'): string {
  return `${CUSTOMER_CSV_COLUMNS.join(',')}\n${example}\n`;
}

/** RFC-4180-ish: handles quoted fields with embedded commas, but not multi-line quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ParsedCustomerImport {
  customers: CustomerUser[];
  errors: ImportRowError[];
  /** Rows that were imported, but with something changed (e.g. a named owner who can't be given real customers). */
  warnings: ImportRowError[];
}

/** The product's own spelling of a type the file wrote (any case); empty when the file has none or it is unknown. */
function matchType(app: AppId, raw: string): string | undefined {
  const t = raw.trim().toLowerCase();
  return t ? customerTypesFor(app).find((x) => x.toLowerCase() === t) : undefined;
}

/**
 * Parses a CSV export into CustomerUser records with the defaults a brand-new real customer
 * should start with (unworked queue, no call history, no fabricated drama). Each row becomes one
 * customer unless it fails validation, in which case it's skipped and reported in `errors` — the
 * whole import never fails for one bad row.
 */
export function parseCustomerCsv(text: string, stateDefs: StateCatalogEntry[], ownerIds?: ReadonlySet<string>): ParsedCustomerImport {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  if (lines.length === 0) return { customers: [], errors: [{ row: 0, message: 'File is empty.' }], warnings };

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    app: col('app'), name: col('name'), phone: col('phone'), business: col('business'),
    city: col('city'), state: col('state'), plan: col('plan'), listings: col('listings'),
    buyers: col('buyers'), registeredAt: col('registered_at'), language: col('language'),
    ownerAgentId: col('owner_agent_id'), customerType: col('type'),
  };
  if (idx.app === -1 || idx.name === -1 || idx.phone === -1) {
    return { customers: [], errors: [{ row: 1, message: 'Header must include at least: app, name, phone.' }], warnings };
  }

  const customers: CustomerUser[] = [];
  const seenIds = new Set<string>();
  const stateNames = new Set(stateDefs.map((s) => s.name));

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1; // 1-based, header is row 1
    const cells = parseCsvLine(lines[i]);
    const get = (j: number) => (j >= 0 && j < cells.length ? cells[j].trim() : '');

    const app = get(idx.app).toLowerCase() as AppId;
    if (!APP_IDS.includes(app)) { errors.push({ row: rowNum, message: `Unknown app "${get(idx.app)}" — expected one of ${APP_IDS.join(', ')}.` }); continue; }

    const name = get(idx.name);
    if (!name) { errors.push({ row: rowNum, message: 'Missing name.' }); continue; }

    const rawPhone = get(idx.phone);
    const digits = normalizePhone(rawPhone);
    if (!digits) { errors.push({ row: rowNum, message: `Invalid phone "${rawPhone}".` }); continue; }

    const id = `cust-${digits}`;
    if (seenIds.has(id)) { errors.push({ row: rowNum, message: `Duplicate phone ${rawPhone} (already imported in this file).` }); continue; }
    seenIds.add(id);

    const stateRaw = get(idx.state);
    const state = stateRaw && stateNames.has(stateRaw) ? stateRaw : null;
    const stateDef = stateDefs.find((s) => s.name === state);
    const effectiveState = stateDef?.name ?? 'Tamil Nadu';
    const city = get(idx.city) || stateDef?.cities[0] || 'Chennai';

    const planRaw = get(idx.plan).toLowerCase();
    const plan = planRaw === 'paid' ? 'Paid' : 'Free';

    const langRaw = get(idx.language);
    const language: Language = customerLanguageFrom(langRaw) ?? stateDef?.language ?? (stateRaw ? languageForState(stateRaw) : 'Tamil');

    const registeredAtRaw = get(idx.registeredAt);
    const registeredTs = registeredAtRaw ? Date.parse(registeredAtRaw) : NaN;
    const now = Date.now();
    const validTs = Number.isFinite(registeredTs) ? registeredTs : now;
    const registeredDaysAgo = Math.max(0, Math.round((now - validTs) / 86400000));

    const listings = Number(get(idx.listings)) || 0;
    const buyers = Number(get(idx.buyers)) || 0;
    // `ownerIds` is who may own a real customer (active, non-demo people). Anyone else named in the file is dropped.
    const namedOwner = get(idx.ownerAgentId) || null;
    const ownerAgentId = namedOwner && ownerIds && !ownerIds.has(namedOwner) ? null : namedOwner;
    if (namedOwner && !ownerAgentId) warnings.push({ row: rowNum, message: `Owner "${namedOwner}" is not an active, non-demo person — imported without an owner.` });

    customers.push({
      id,
      origin: 'app',
      shopCode: `TS${id.slice(5, 15).padStart(10, '0')}`,
      name,
      business: get(idx.business) || name,
      app,
      phone: `+${digits}`,
      city,
      state,
      effectiveState,
      stateName: stateRaw || undefined,
      language,
      registeredAtLabel: new Date(validTs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      registeredDaysAgo,
      plan,
      listings,
      buyers,
      lastOpenLabel: 'Not yet opened',
      appVersion: '—',
      conversionScore: 50,
      stageTag: 'New',
      queue: 'new',
      attempt: 0,
      callHistory: [],
      tickets: [],
      paying: plan === 'Paid',
      active: true,
      hasActiveEscalation: false,
      ownerAgentId,
      customerType: matchType(app, get(idx.customerType)),
    });
  }

  return { customers, errors, warnings };
}
