// Signing in to one product. The sign-in page shows every product as a card; a person picks one and signs in to it,
// and only if their account has that product. The whole session then works inside it: the person's product list is
// narrowed to it for every screen (src/store/StoreContext.tsx), while the stored account keeps all its products.
import type { AgentAccount, AppId } from '../data/types.ts';

const KEY = 'tcc.product';

/** Admins (and Tecstellar's super admin) run every product; everyone else only the ones on their account. */
export function mayEnter(agent: Pick<AgentAccount, 'role' | 'apps' | 'superAdmin'>, app: AppId): boolean {
  return Boolean(agent.superAdmin) || agent.role === 'admin' || agent.apps.includes(app);
}

/** The person as the screens see them inside one product. Admins keep the lot: they can still look across products. */
export function inProduct(agent: AgentAccount, app: AppId): AgentAccount {
  if (agent.superAdmin || agent.role === 'admin') return agent;
  return agent.apps.length === 1 && agent.apps[0] === app ? agent : { ...agent, apps: agent.apps.filter((a) => a === app) };
}

/** Why someone can't go into a product, in words for the sign-in page. */
export const noAccessMessage = (productName: string) => `Your account doesn’t have ${productName}. Ask your admin to add it, or pick another product.`;

/** The product this browser last went into (kept across reloads; cleared on sign-out). Storage can be blocked: then none. */
export function readProduct(): AppId | null {
  try {
    return (localStorage.getItem(KEY) as AppId | null) || null;
  } catch {
    return null;
  }
}

export function writeProduct(app: AppId | null) {
  try {
    if (app) localStorage.setItem(KEY, app);
    else localStorage.removeItem(KEY);
  } catch {
    // Private window or blocked storage: the choice lasts until the page reloads.
  }
}
