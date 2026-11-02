// What kinds of customer each product has. This is the one place that differs per product; every screen reads it,
// so a new product is a new entry here (later: an admin screen) and nothing else.
import type { AppId } from './types.ts';

export interface ProductConfig {
  /** Who the agent is talking to, in the product's own words. The last entry is always the catch-all. */
  customerTypes: string[];
  /** True until the product's owner has confirmed the list. */
  provisional?: boolean;
}

export const PRODUCT_CONFIG: Record<AppId, ProductConfig> = {
  realbroks: { customerTypes: ['Broker', 'Non-broker', 'Other'] },
  influnet: { customerTypes: ['Influencer', 'Business owner', 'Other'] },
  irondrobe: { customerTypes: ['Shop owner', 'Individual', 'Other'], provisional: true },
  vehigo: { customerTypes: ['Owner', 'Driver', 'Other'], provisional: true },
  vanmoh: { customerTypes: ['Subscriber', 'Prospect', 'Other'], provisional: true },
};

export const customerTypesFor = (app: AppId): string[] => PRODUCT_CONFIG[app].customerTypes;
