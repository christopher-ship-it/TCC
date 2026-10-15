# telephony — reusable in-app calling module

Self-contained: nothing in this folder imports from the rest of the app (a test enforces it), so it can be
copied — or later published as a package — into any React project.

```
core/        no framework. PhoneController (owns one provider + call state), a pure reducer, number normaliser, types
providers/   mock.ts (fake line, no network) · telecmi/adapter.ts (browser softphone) · telecmi/webhook.ts (server-side CDR normaliser)
react/       <TelephonyProvider>, useTelephony(), <CallPanel> (dial, mute, hold, keypad, end, sign-in form)
tests/       node --test (npm test) — no extra dev dependencies
```

## Using it in an app

```tsx
const provider = new TeleCmiProvider({ scriptUrl: piopiyScriptUrl });   // or new MockProvider()

<TelephonyProvider provider={provider} defaultCountryCode="91" onCallEnded={(r) => save(r)}>
  <CallPanel number={customer.phone} label={customer.name} meta={{ customerId: customer.id }} />
</TelephonyProvider>
```

The app supplies three things: the provider, the number/tags per call, and what to do with a `CallResult`
(`disposition`, `talkSeconds`, `providerCallId`, your `meta`). Map `disposition` onto your own statuses — TCC's
mapping is in `src/lib/telephony.ts`. Theme `<CallPanel>` with `--telephony-*` CSS variables.

`scriptUrl` must point at `piopiyjs/dist/piopiy.min.js` (Vite: `import url from 'piopiyjs/dist/piopiy.min.js?url'`).
The package's `lib/` entry needs `lodash`, which it doesn't declare, so the prebuilt bundle is the reliable route.

## Adding another provider (Exotel, Twilio…)

Implement `TelephonyProvider` (core/types.ts): translate your SDK's events into `ProviderEvent`s. Nothing above it changes.

## Mock line (dev/demos)

Answers by last digit of the dialled number: `1` no answer · `2` busy · `3` switched off · `4` invalid · `5` declined ·
anything else answers after ~2.5 s. `bad` as the password makes login fail.

## Tags

`meta` is sent with the call (TeleCMI: one JSON string in `extra_param`) and comes back on the webhook
(`normalizeTeleCmiWebhook(...).meta`). That is how a CDR is tied back to a customer and agent.

## Live TeleCMI Dialling & Production Modes

When wrapping this module into an app (e.g. `src/lib/telephony.ts` in TCC):
- **Development / Test Mode (`VITE_TELEPHONY_TEST_NUMBER`)**: Diverts every outbound call to a safe developer phone (e.g. `8270942966`), preventing accidental calls to mock/sample data.
- **Production Mode (`VITE_TELEPHONY_LIVE=true`)**: Dials each customer's actual individual phone number (`user.phone`) through the TeleCMI SIP trunk.
- **Safety Lock**: If neither is set, calling is disabled by default to guard against dialing randomly generated seed numbers.

## Verified against live TeleCMI account

Verified with live SIP calls on App ID `33338836`:
- Call states (`trying` → `ringing` → `answered` → `ended`) map seamlessly.
- Virtual input fallback: detects silent inputs (BlackHole, Teams, etc.) and routes to the real hardware mic.
- Post-call recording retrieval: fetches recording file from `out_cdr` using the agent's REST token without requiring the TeleCMI App Secret in the browser.

## Known limits

- The SDK is single-session and a page-level singleton: one call at a time, one signed-in user per browser tab.
- A second inbound call while busy is ignored.
- Agent passwords are typed per session and held in memory only. Production needs real per-agent auth plus a server
  that hands out softphone credentials — never ship the TeleCMI App Secret to the browser.
