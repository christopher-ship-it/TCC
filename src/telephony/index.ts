// Public surface of the telephony module. Import from here, never from deep paths.
export { PhoneController, type ControllerOptions, type DialResult } from './core/controller.ts';
export { normalizePhone } from './core/phone-number.ts';
export { initialSnapshot, reduce, type Action } from './core/reducer.ts';
export type {
  CallDirection, CallResult, CallSession, CallSnapshot, CallState, ConnectionState, Credentials, Disposition, Meta, ProviderEvent, TelephonyProvider as TelephonyProviderContract,
} from './core/types.ts';

export { MockProvider, scenarioFromLastDigit, type MockOptions, type MockScenario } from './providers/mock.ts';
export { TeleCmiProvider, TELECMI_REGIONS, type TeleCmiConfig } from './providers/telecmi/adapter.ts';
export { normalizeTeleCmiWebhook, type NormalizedWebhook, type WebhookStatus } from './providers/telecmi/webhook.ts';

export { TelephonyProvider, type TelephonyProviderProps } from './react/TelephonyProvider.tsx';
export { CallPanel, type CallPanelProps } from './react/CallPanel.tsx';
export { useTelephony, useTelephonyOptional, useElapsedSeconds, formatDuration } from './react/hooks.ts';
