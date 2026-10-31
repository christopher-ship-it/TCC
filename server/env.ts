// Server-side settings. Read from the process environment and the repo's .env / .env.local (vite.config.ts
// passes them in through loadEnv). Secrets here never reach the browser bundle: only VITE_* variables do.

import path from 'node:path';
import { brandKey, type BrandKey } from '../src/brand/profiles.ts';
import { sourcesFromEnv, type SourceConfig } from './appSync.ts';

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
  /** Shared secret in the TeleCMI webhook URL (TCC_WEBHOOK_SECRET). Unset = the webhook accepts nothing. */
  webhookSecret?: string;
  /** Extra addresses the app is served at through a proxy that rewrites the Host header (TCC_PUBLIC_HOSTS,
   *  comma-separated) — e.g. vanmohchitfunds.buziness365.com, forwarded by BusinessOS to this service. */
  publicHosts: string[];
  /** Asked for when the very first admin account is created (TCC_SETUP_CODE). Unset = the first visitor may create it. */
  setupCode?: string;
  /** Products whose own database TCC syncs customers from (<APP>_API_URL + <APP>_API_KEY; server/appSync.ts). */
  sources: SourceConfig[];
  /** Minutes between change checks against those products (TCC_SOURCE_SYNC_MINUTES, default 10). */
  sourceSyncMinutes: number;
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
    setupCode: pick(vars.TCC_SETUP_CODE),
    webhookSecret: pick(vars.TCC_WEBHOOK_SECRET),
    sources: sourcesFromEnv(vars),
    sourceSyncMinutes: Number(pick(vars.TCC_SOURCE_SYNC_MINUTES)) || 10,
    publicHosts: (vars.TCC_PUBLIC_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  };
}
