export interface NormalizeOptions {
  /** Country code assumed for national numbers (digits only). Default '91' (India). */
  defaultCountryCode?: string;
}

/**
 * Normalises a human-typed number to E.164 digits without '+', which is what
 * softphone SDKs expect ("+91 98765 43210", "098765 43210" and "9876543210" all
 * become "919876543210"). Returns null when the result can't be a real number.
 */
export function normalizePhone(raw: string, opts: NormalizeOptions = {}): string | null {
  const cc = (opts.defaultCountryCode ?? '91').replace(/\D/g, '');
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (!hadPlus) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2); // international dialling prefix
    } else {
      if (digits.startsWith('0')) digits = digits.slice(1); // national trunk prefix
      if (digits.length <= 10) digits = cc + digits; // national number → add country code
    }
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
