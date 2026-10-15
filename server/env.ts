// Server-side settings. Read from the process environment and the repo's .env / .env.local (vite.config.ts
// passes them in through loadEnv). Secrets here never reach the browser bundle: only VITE_* variables do.

import path from 'node:path';
import { brandKey, type BrandKey } from '../src/brand/profiles.ts';

export interface ServerEnv {
  telecmiAppId?: string;
  /** TeleCMI App Secret (Dashboard › Settings › Developer). Server only — never a VITE_ variable. */
  telecmiSecret?: string;
  telecmiDashboardHost: string;
  geminiKey?: string;
  geminiModel: string;
  /** Neon / Postgres connection string. Server only — never a VITE_ variable. Unset = no database. */
  databaseUrl?: string;
  /** Where downloaded recordings and analyses are cached. */
  dataDir: string;
  /** The white label this deployment runs as (VITE_BRAND; unset = Tecstellar). Shapes the call-analysis prompt. */
  brand: BrandKey;
}

const pick = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function readServerEnv(vars: Record<string, string | undefined>, root: string): ServerEnv {
  return {
    telecmiAppId: pick(vars.TELECMI_APP_ID) ?? pick(vars.VITE_TELECMI_APP_ID),
    telecmiSecret: pick(vars.TELECMI_APP_SECRET),
    telecmiDashboardHost: pick(vars.TELECMI_DASHBOARD_HOST) ?? pick(vars.VITE_TELECMI_DASHBOARD_HOST) ?? 'connle.telecmi.com',
    databaseUrl: pick(vars.DATABASE_URL),
    geminiKey: pick(vars.GEMINI_API_KEY),
    geminiModel: pick(vars.GEMINI_MODEL) ?? 'gemini-2.5-flash',
    dataDir: path.join(root, '.data'),
    brand: brandKey(vars.VITE_BRAND),
  };
}
