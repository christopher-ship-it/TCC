import type { CSSProperties, ReactNode } from 'react';
import type { AgentAccount, CustomerUser } from '../../data/types';
import { CallPanel, TelephonyProvider } from '../../telephony';
import { DEFAULT_COUNTRY_CODE, LIVE_DIAL_BLOCKED, TEST_NUMBER, callMeta, dialNumberFor, telephonyProvider } from '../../lib/telephony';

// Maps the module's theme variables onto TCC's design tokens.
const theme = {
  '--telephony-accent': 'var(--color-accent)',
  '--telephony-danger': '#a3271b',
  '--telephony-ok': 'var(--color-accent-2)',
  '--telephony-text': 'var(--color-text)',
  '--telephony-muted': 'var(--color-neutral-700)',
  '--telephony-border': 'var(--color-divider)',
  '--telephony-surface': 'var(--color-neutral-100)',
  '--telephony-radius': '0px',
  '--telephony-font': 'var(--font-body)',
} as CSSProperties;

// The mock line needs no login; a real provider makes the agent sign in through the panel.
const MOCK_CREDENTIALS = { userId: 'mock-agent', password: '' };

const savedUserKey = (agentId: string) => `tcc.softphone.user.${agentId}`;

function rememberedUserId(agent: AgentAccount): string | undefined {
  if (agent.telecmiUserId) return agent.telecmiUserId;
  try {
    return localStorage.getItem(savedUserKey(agent.id)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Mounts the softphone around the agent workspace. When no telephony provider is configured it renders children untouched. */
export default function AgentTelephony({ children }: { children: ReactNode }) {
  if (!telephonyProvider) return <>{children}</>;
  return (
    <TelephonyProvider provider={telephonyProvider} defaultCountryCode={DEFAULT_COUNTRY_CODE} credentials={telephonyProvider.requiresCredentials ? null : MOCK_CREDENTIALS}>
      {children}
    </TelephonyProvider>
  );
}

const notice: CSSProperties = { fontSize: 12, lineHeight: 1.45, padding: 'var(--space-2)', background: 'var(--color-accent-100)', borderLeft: '2px solid var(--color-accent)' };

export function TccCallPanel({ user, agent }: { user: CustomerUser; agent: AgentAccount }) {
  if (LIVE_DIAL_BLOCKED) {
    return (
      <div style={notice}>
        <strong>Live dialling is off.</strong> Customer numbers are still sample data, so calling them would ring real strangers. Set <code>VITE_TELEPHONY_TEST_NUMBER</code> to route every call to your own phone, or <code>VITE_TELEPHONY_LIVE=true</code> once real data is connected.
      </div>
    );
  }
  return (
    <>
    {TEST_NUMBER && <div style={{ ...notice, marginBottom: 'var(--space-2)' }}><strong>Test mode</strong> — every call rings {TEST_NUMBER}, not {user.name}.</div>}
    <CallPanel
      style={theme}
      number={dialNumberFor(user)}
      label={user.name}
      meta={callMeta(user, agent)}
      shortcutHint="F1"
      defaultUserId={rememberedUserId(agent)}
      onCredentialsSubmit={(c) => {
        try {
          localStorage.setItem(savedUserKey(agent.id), c.userId); // user id only — never the password
        } catch {
          /* private mode: fine, they just retype it */
        }
      }}
    />
    </>
  );
}

