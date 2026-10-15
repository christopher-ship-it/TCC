// "Dial a number": a call to a number that is not in the customer list. It still needs a customer record to hang
// the call log, recording and analysis on, so the number gets a minimal one (flagged `adHoc`, in no queue).
import { normalizePhone } from '../telephony/core/phone-number.ts';
import type { AppId, CustomerUser } from '../data/types.ts';

export const adHocId = (digits: string) => `adhoc-${digits}`;

/** E.164 digits for what the agent typed, or null when it can't be a phone number. */
export function directDialDigits(raw: string, countryCode: string): string | null {
  return normalizePhone(raw, { defaultCountryCode: countryCode });
}

export function adHocCustomer(digits: string, app: AppId, now = Date.now()): CustomerUser {
  return {
    id: adHocId(digits),
    shopCode: `DD${digits.slice(-10).padStart(10, '0')}`,
    name: `+${digits}`,
    business: 'Direct call',
    app,
    phone: `+${digits}`,
    city: '—',
    state: null,
    effectiveState: '—',
    language: 'English',
    registeredAtLabel: new Date(now).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    registeredDaysAgo: 0,
    plan: 'Free',
    listings: 0,
    buyers: 0,
    lastOpenLabel: '—',
    appVersion: '—',
    conversionScore: 0,
    stageTag: 'Direct call',
    queue: null,
    attempt: 0,
    callHistory: [],
    tickets: [],
    paying: false,
    active: true,
    hasActiveEscalation: false,
    ownerAgentId: null,
    adHoc: true,
  };
}
