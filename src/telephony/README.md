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

## Not verified against a live account yet

Built while the TeleCMI plan was expired. Confirm on the first real calls:
- what `ended` reports for each failure (`reducer.ts` `classify()` assumes 486 busy, 408/487/200 no answer, 480/484/404 unreachable),
- which webhook field carries our tags for SDK-placed calls (`custom` vs `extra_params` — both are read),
- incoming-call CDR shape (only outgoing samples were reviewed),
- that login works from the office network (TeleCMI can restrict by IP → `loginFailed` 407).

## Known limits

- The SDK is single-session and a page-level singleton: one call at a time, one signed-in user per browser tab.
- A second inbound call while busy is ignored.
- Agent passwords are typed per session and held in memory only. Production needs real per-agent auth plus a server
  that hands out softphone credentials — never ship the TeleCMI App Secret to the browser.
