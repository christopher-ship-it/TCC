// White label: who this deployment of TCC is for. One codebase, one brand per deployment, chosen at build time by
// VITE_BRAND (unset = Tecstellar, exactly as before). A brand changes the name, logo, colours and the words the
// screens use for its business; every feature, the stored data shapes and the outcome keys stay the same.
//
// Pure data — imported by the browser (src/brand/index.ts) and by the server (call analysis prompt).

export type BrandKey = 'tecstellar' | 'vanmoh';

export function brandKey(raw: string | null | undefined): BrandKey {
  return raw?.trim().toLowerCase() === 'vanmoh' ? 'vanmoh' : 'tecstellar';
}

type QueueId = 'new' | 'tickets' | 'payments' | 'followup' | 'errors' | 'inactive';

export interface BrandFields {
  app: string;
  listings: string;
  buyers: string;
  plan: string;
  /** Badge text for a paying / non-paying customer. */
  paid: string;
  free: string;
  registered: string;
  lastOpen: string;
  appVersion: string;
  mrr: string;
  /** Why a new customer is in the queue: "Enquired 3 days ago and hasn't joined a group yet." */
  newVerb: string;
  notYet: string;
  /** Why an inactive customer is in the queue. */
  inactive: string;
}

export interface BrandProfile {
  key: BrandKey;
  /** Company name as shown beside the logo. */
  name: string;
  /** Browser tab title. */
  title: string;
  loginHeadline: string;
  loginBlurb: string;
  usernamePlaceholder: string;
  emailPlaceholder: string;
  /** Screen words for the queues, by queue key. Missing = the default words. */
  queueLabels: Partial<Record<QueueId, { label: string; short: string }>>;
  /** Screen words for call outcomes, by stored outcome. Missing = the outcome as stored. */
  outcomeLabels: Record<string, string>;
  /**
   * What the generic customer fields mean for this business. Null = Tecstellar's own per-app words (Listings for
   * RealBroks, Orders for IronDrobe …), which the screens keep exactly as they were.
   */
  fields: BrandFields | null;
  /** Business context for the call analyst (Gemini). */
  analysis: { team: string; products: string; caller: string; languages: string; outcomeNotes: string };
}

export const BRANDS: Record<BrandKey, BrandProfile> = {
  tecstellar: {
    key: 'tecstellar',
    name: 'Tecstellar',
    title: 'Tecstellar Command Center',
    loginHeadline: 'Command Center',
    loginBlurb: 'Every customer of RealBroks, IronDrobe, Influnet and Vehigo in one place — calls, recordings, follow-ups, payments and the people who handle them.',
    usernamePlaceholder: 'abhinaya.m',
    emailPlaceholder: 'you@tecstellar.com',
    queueLabels: {},
    outcomeLabels: {},
    fields: null,
    analysis: {
      team: 'Tecstellar Command Center, the team that calls customers of Tecstellar\'s apps',
      products: 'RealBroks — a broker assistant for real-estate agents; IronDrobe — a CRM for laundry and ironing shops; Influnet; Vehigo',
      caller: 'the Tecstellar caller',
      languages: 'Tamil, Telugu, Kannada, Malayalam, Hindi, English or a mix',
      outcomeNotes: '',
    },
  },
  vanmoh: {
    key: 'vanmoh',
    name: 'Vanmoh Chit Funds',
    title: 'Vanmoh Command Center',
    loginHeadline: 'Command Center',
    loginBlurb: 'Every subscriber and enquiry of Vanmoh Chit Funds in one place — calls, recordings, instalment dues, auctions, follow-ups and the people who handle them.',
    usernamePlaceholder: 'kavitha.r',
    emailPlaceholder: 'you@vanmohchitfunds.com',
    queueLabels: {
      new: { label: 'New enquiries', short: 'Enquiries' },
      tickets: { label: 'Complaints & requests', short: 'Requests' },
      payments: { label: 'Instalment dues', short: 'Dues' },
      followup: { label: 'Interested follow-up', short: 'Follow-up' },
      errors: { label: 'Failed & bounced payments', short: 'Failed pay' },
      inactive: { label: 'Lapsed 30+ days', short: 'Lapsed' },
    },
    outcomeLabels: {
      'Ready to subscribe': 'Ready to join',
      'Created first listing': 'Joined a group',
      'Payment issue': 'Instalment / payment issue',
      'Technical issue': 'Service complaint',
      'Using competitor': 'With another chit / bank',
    },
    fields: {
      app: 'Company',
      listings: 'Instalments paid',
      buyers: 'Instalments total',
      plan: 'Scheme',
      paid: 'Subscriber',
      free: 'Enquiry',
      registered: 'Enquired',
      lastOpen: 'Last instalment',
      appVersion: 'Collection',
      mrr: 'Instalment',
      newVerb: 'Enquired',
      notYet: 'joined a group',
      inactive: 'No instalment paid since',
    },
    analysis: {
      team: 'Vanmoh Chit Funds Pvt Ltd (Coimbatore and Nilgiris, Tamil Nadu), whose call team phones chit-fund enquiries and subscribers',
      products: 'registered chit schemes of 10, 20, 30 and 40 months from ₹10,000 to ₹10,00,000, monthly auctions, doorstep collection daily, weekly or monthly',
      caller: 'the Vanmoh caller',
      languages: 'Tamil, English, Malayalam or a mix',
      outcomeNotes: `Outcome words mean, for this business: "Ready to subscribe" = ready to join a chit group; "Created first listing" = has joined a group / paid the first instalment;
"Payment issue" = an instalment or payment problem; "Technical issue" = a service complaint (missed collection, receipt, auction query);
"Using competitor" = saving with another chit company, bank RD or gold scheme instead.`,
    },
  },
};
