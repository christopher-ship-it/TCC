// What TCC asks each product's API for and what it does with the answers. The contract is docs/client-api-guide; the
// field mapping mirrors src/lib/appSync.ts. The live numbers (calls, errors, last answer) come from the server.

export interface EndpointDoc {
  method: 'GET' | 'POST';
  /** Relative to the product's TCC API base address. */
  path: string;
  /** How the server groups it in its numbers ("customers/:id"). */
  key: string;
  purpose: string;
  when: string;
  params?: { name: string; value: string; note: string }[];
  /** What TCC takes from the answer. */
  uses: string[];
}

export const PRODUCT_ENDPOINTS: EndpointDoc[] = [
  {
    method: 'GET', path: 'meta', key: 'meta',
    purpose: 'Names the app and lists its set-up steps in order. Doubles as the health check for the key.',
    when: 'At the start of every sync, and when you press Test now.',
    uses: ['onboarding_stages (the order and labels of set-up steps)', 'usage_labels (what the two counts are called)', 'customer_types', 'total_customers'],
  },
  {
    method: 'GET', path: 'customers', key: 'customers',
    purpose: 'The list TCC keeps itself in step with, 500 customers a page.',
    when: 'Every 10 minutes for customers changed since the last run (asked from a minute before, so nothing slips through), and once a day for everyone.',
    params: [
      { name: 'limit', value: '500', note: 'Page size.' },
      { name: 'include_deleted', value: 'true', note: 'So blocked and deleted customers can be hidden in TCC.' },
      { name: 'updated_since', value: 'newest updated_at seen − 1 min', note: 'Left out on the daily full run.' },
      { name: 'cursor', value: 'next_cursor from the page before', note: 'Paging; the product orders by updated_at then id.' },
    ],
    uses: ['every field in the mapping below', 'updated_at (where the next change check starts)', 'next_cursor / has_more (paging)'],
  },
  {
    method: 'POST', path: 'customers/lookup', key: 'customers/lookup',
    purpose: 'Finds a customer by phone number when someone calls in who TCC does not know yet.',
    when: 'On an incoming call from an unknown number, for each product the agent works for. The number is sent in the body, not the address.',
    params: [{ name: 'phone', value: 'the caller’s number', note: 'The product matches on the last 10 digits.' }],
    uses: ['the same customer fields as the list (the match is saved as a customer straight away)'],
  },
  {
    method: 'GET', path: 'customers/{id}', key: 'customers/:id',
    purpose: 'One customer by the product’s own id.',
    when: 'Not called by any schedule today. Available for checking a single customer; it returns the same fields as the list.',
    uses: ['the same customer fields as the list'],
  },
];

export const CALL_FACTS = [
  ['Sign-in', 'Every call carries the key as “Authorization: Bearer <key>”. The key lives only on TCC’s server and is never logged, shown or sent to a browser.'],
  ['Format', 'JSON over HTTPS. Phone numbers in E.164 (+91…). Times in ISO 8601.'],
  ['Read only', 'TCC never writes to a product. It only reads.'],
  ['Matching', 'A product’s customer is matched to TCC’s by the last 10 digits of the phone number. TCC’s own notes, calls, follow-ups and owner are never overwritten by a sync.'],
] as const;

export const FIELD_MAP: { from: string; to: string; note: string }[] = [
  { from: 'id', to: 'Product id on the customer', note: 'Stays the same for the same customer.' },
  { from: 'phone', to: 'Phone', note: 'E.164. The key TCC matches customers on (last 10 digits).' },
  { from: 'name', to: 'Name', note: 'Falls back to business_name, then the phone number. Agents can fill it in when the product has none.' },
  { from: 'business_name', to: 'Business / shop', note: 'Agents can fill it in when empty.' },
  { from: 'city', to: 'City', note: 'Agents can fill it in when empty.' },
  { from: 'state', to: 'State and the map', note: 'Kept exactly as sent so every state shows on the Customer map. Decides the calling language: Tamil Nadu and Puducherry → Tamil, Kerala → Malayalam, Andhra Pradesh and Telangana → Telugu, Karnataka → Kannada, every other state → Hindi.' },
  { from: 'preferred_language', to: 'Language', note: 'A code such as ta, ml, te, kn, hi (bn counts as Hindi). Beats the state. “en” is ignored: no customer is called in English.' },
  { from: 'registered_at', to: 'Days since sign-up', note: 'Decides New installs: the ones who signed up yesterday are called first.' },
  { from: 'last_active_at', to: 'Last opened, Active', note: 'Not opened for 30+ days puts them in the Inactive list.' },
  { from: 'onboarding.stage / completed / last_error', to: 'Call list and stage', note: 'Set-up not finished → New installs or Errors & drop-offs.' },
  { from: 'usage.primary_count / secondary_count', to: 'Listings / orders and buyers / end customers', note: 'The words come from usage_labels in meta.' },
  { from: 'plan.name / plan.is_paid', to: 'Plan, Paying', note: 'TCC’s own “marked paid” is kept until the product’s plan changes.' },
  { from: 'payment_due', to: 'Payments & dues list', note: '' },
  { from: 'open_tickets', to: 'Tickets & flags list', note: '' },
  { from: 'account_status', to: 'Hidden when blocked or deleted', note: 'Only active customers are called.' },
  { from: 'customer_type', to: 'Customer type', note: 'Used when the product sends one; agents can set it from the call card.' },
  { from: 'updated_at', to: 'Where the next change check starts', note: 'Must change whenever anything about the customer changes, or TCC misses it until the daily full run.' },
];

/** What a product is known to leave empty, as last checked. Shown only for that product. */
export const KNOWN_GAPS: Record<string, { checked: string; notes: string[] }> = {
  irondrobe: {
    checked: '30 Oct 2026',
    notes: [
      'About 3 in 10 customers (all at the “registered” step) have no name, shop, city or state, because IronDrobe does not have them yet. Agents fill them in on the call.',
      'Always empty at that check: customer_type, email, pincode, alt_phone, acquisition_source, open_tickets, payment_due, onboarding.last_error, plan.monthly_value. So the Tickets, Payments and Errors lists stay empty until IronDrobe fills them.',
      'The key only works with its lowercase prefix (irondrobe_live_…). A capital I is refused.',
      'IronDrobe has a second, separate API under /api/v1/tcc/ for business numbers (orders, payments, subscriptions). TCC does not call it yet: at last check it answered “authentication is not configured”.',
    ],
  },
};

/** Services TCC calls that are not a product: the same for every product. */
export const OTHER_SERVICES: { name: string; host: string; calls: string[]; limits: string }[] = [
  {
    name: 'TeleCMI (phone line)',
    host: 'rest.telecmi.com · piopiy.telecmi.com',
    calls: ['POST /v2/user/status: sets an agent online or offline so incoming calls ring them', 'GET /v2/play and /v2/piopiy/play: downloads a call recording for the player', 'POST /v2/answered: checks the keys work (System › Test now)', 'Receives TeleCMI’s call-detail webhook at POST /api/telephony/webhook?secret=…'],
    limits: 'TCC allows 300 webhook posts a minute and 120 recording downloads a minute per person.',
  },
  {
    name: 'Google Gemini (call analysis)',
    host: 'generativelanguage.googleapis.com',
    calls: ['POST /v1beta/models/<model>:generateContent: sends a recording and gets the transcript, summary, sentiment and next step back'],
    limits: 'TCC allows 30 analyses a minute per person, runs at most 4 at once, and waits when Gemini asks it to.',
  },
];
