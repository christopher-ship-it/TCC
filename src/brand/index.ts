// The brand this build is for (VITE_BRAND, see profiles.ts). `import.meta.env` is undefined when the node test
// runner loads this file, which then falls back to Tecstellar like an unset variable does.
import { BRANDS, brandKey, type BrandProfile } from './profiles.ts';

export type { BrandKey, BrandProfile, BrandFields } from './profiles.ts';

const env = (import.meta as { env?: Record<string, string | undefined> }).env;

export const BRAND: BrandProfile = BRANDS[brandKey(env?.VITE_BRAND)];

/** True for a client build (anything but Tecstellar's own). */
export const WHITE_LABEL = BRAND.key !== 'tecstellar';

/** A call outcome in this brand's words. Stored outcomes never change; only what the screens say. */
export function outcomeLabel(outcome: string): string {
  return BRAND.outcomeLabels[outcome] ?? outcome;
}
