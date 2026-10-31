// Where customers are: matching the state names products send to the states on the India map, and counting customers
// by state and by language. Plain functions, so they can be tested.
import type { CustomerUser, Language } from '../data/types.ts';
import { languageForState } from './languages.ts';

/** Every state and territory the map draws (the @svg-maps/india names). */
export const MAP_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli', 'Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
] as const;

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

const BY_NAME = new Map<string, string>(MAP_STATES.map((n) => [norm(n), n]));
// Other spellings products and spreadsheets use. Ladakh is drawn as part of Jammu and Kashmir on this map.
const ALIASES: Record<string, string> = {
  orissa: 'Odisha', pondicherry: 'Puducherry', uttaranchal: 'Uttarakhand', chattisgarh: 'Chhattisgarh', telengana: 'Telangana',
  'nct of delhi': 'Delhi', 'new delhi': 'Delhi', 'delhi ncr': 'Delhi', 'j and k': 'Jammu and Kashmir', ladakh: 'Jammu and Kashmir',
  'dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli', 'dadra and nagar haveli and daman diu': 'Dadra and Nagar Haveli',
  daman: 'Daman and Diu', diu: 'Daman and Diu', 'andaman nicobar islands': 'Andaman and Nicobar Islands', 'andaman and nicobar': 'Andaman and Nicobar Islands',
  'tamilnadu': 'Tamil Nadu', 'tamil nadu state': 'Tamil Nadu', 'andhra': 'Andhra Pradesh', 'uttarpradesh': 'Uttar Pradesh', 'madhyapradesh': 'Madhya Pradesh',
};

/** The map's name for whatever a product or spreadsheet calls a state, or null when it isn't one. */
export function canonicalState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = norm(raw);
  return BY_NAME.get(k) ?? (ALIASES[k] ? ALIASES[k] : null);
}

/** The state to draw a customer in: the one the product sent, else the one TCC knows. Null = no state on record. */
export const mapStateOf = (u: Pick<CustomerUser, 'stateName' | 'state'>): string | null => canonicalState(u.stateName) ?? canonicalState(u.state);

export interface StateStat {
  name: string;
  customers: number;
  active: number;
  paying: number;
  mrr: number;
  /** The language customers here are called in, by the team's rule (Tamil Nadu → Tamil …). */
  language: Language;
  byLanguage: Partial<Record<Language, number>>;
}

const blank = (name: string): StateStat => ({ name, customers: 0, active: 0, paying: 0, mrr: 0, language: languageForState(name), byLanguage: {} });

/** Customers counted by state, plus those with no state on record. */
export function stateStats(users: Pick<CustomerUser, 'stateName' | 'state' | 'language' | 'active' | 'paying' | 'mrr' | 'deleted'>[]): { byState: Map<string, StateStat>; unknown: StateStat } {
  const byState = new Map<string, StateStat>();
  const unknown = blank('No state on record');
  for (const u of users) {
    if (u.deleted) continue;
    const name = mapStateOf(u);
    const s = name ? (byState.get(name) ?? byState.set(name, blank(name)).get(name)!) : unknown;
    s.customers++;
    if (u.active) s.active++;
    if (u.paying) s.paying++;
    s.mrr += u.mrr ?? 0;
    s.byLanguage[u.language] = (s.byLanguage[u.language] ?? 0) + 1;
  }
  return { byState, unknown };
}

/** The language most of a state's customers are called in. */
export function dominantLanguage(s: StateStat): Language {
  let best: Language = s.language;
  let n = -1;
  for (const [l, c] of Object.entries(s.byLanguage) as [Language, number][]) if (c > n) [best, n] = [l, c];
  return best;
}

/** Colours per language on the map: distinct in light and dark. */
export const LANGUAGE_COLOR: Record<Language, string> = {
  Tamil: '#1d4ed8',
  Malayalam: '#d97a1e',
  Telugu: '#1a7f35',
  Kannada: '#7c3aed',
  Hindi: '#be185d',
  Others: '#8a949d',
  English: '#8a949d',
};
