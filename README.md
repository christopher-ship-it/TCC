# Tecstellar Command Center

A working implementation of the TCC design (`../Tecstellar Command Center.dc.html`), built as a
React + TypeScript single-page app with a generated, realistic sample dataset (810 customer
records across RealBroks and IronDrobe, 6 seeded agent/supervisor/owner accounts, 12 Indian
states, live escalations).

## Run it

```
npm install
npm run dev
```

Open the printed local URL. Sign in with any of the quick-select accounts on the login screen
(agent, supervisor, or owner) — the password field is cosmetic, only the username is checked.

## What's implemented

- **Login** — role-based landing (agent → launcher, supervisor → team performance, admin → owner dashboard).
- **Agent launcher** — per-app tiles with live queue counts, "Serve my next task."
- **Agent workspace** (the "1a Focus" direction from the design) — the 3-step call panel (reach →
  connect → outcome), keyboard shortcuts (1–5 status, Q–I outcome, Enter to save, S to skip, T to
  raise a ticket), the weekly positive follow-up chain, and a queue-pill rail that only shows the
  queues an agent is assigned — this is how a restricted agent (e.g. Priya N, one queue) differs
  from a full-access agent (e.g. Abhinaya M, six queues across two apps) without a separate screen.
- **Mid-call reroute / escalate** modal, wired to a live escalations queue.
- **Supervisor** — team performance, team & access (create logins, tick queue access, coverage
  gaps), language/state allocation (with a live "reachable users" count), and an escalations inbox
  with approve/decline.
- **Owner** — all-apps dashboard (funnel, leaderboard, churn, SLA health) and a Geography screen
  with a real India choropleth-style map (D3, state boundaries + circles sized by user count).

## Data backend

The app runs on one of two backends, chosen automatically:

- **No `VITE_FIREBASE_*` env vars set** — everything lives in this browser's `localStorage`
  (`src/store/LocalStoreProvider.tsx`). Single-browser only, zero setup. This is what the
  published single-file artifact preview runs on.
- **Firebase configured** (`.env.local`, see `.env.example`) — TCC's own operational data (agent
  logins, call logs, tickets, follow-up chains, escalations) lives in a dedicated Firestore project
  and updates live across every browser signed into it (`src/store/FirestoreStoreProvider.tsx`).

Either way, **customer master data** (name, phone, city, plan, registration date — the fields that
belong to the actual RealBroks/IronDrobe apps) is still the generated sample set
(`src/data/seed.ts`). It hasn't been wired to the real app database yet; that's a separate,
pending integration once its connection details are available. The split is deliberate:
`CustomerOverlay` (`src/data/types.ts`) is exactly the subset of a customer record TCC itself
owns and writes — everything else on `CustomerUser` is master data. Swapping the master data
source later means replacing `generateSeed()`'s customer generation with a real fetch; nothing in
the overlay/store/UI layer needs to change.

### Firebase setup

1. Copy `.env.example` to `.env.local` and fill in your Firebase project's client config
   (Firebase Console → Project Settings → General → Your apps). This file is gitignored.
2. Enable **Firestore Database** (Build → Firestore Database → Create database).
3. Enable **Anonymous** sign-in (Build → Authentication → Sign-in method → Anonymous → Enable).
   The app signs every browser in anonymously — there's no per-agent Firebase Auth yet, TCC logins
   are its own username-based accounts stored in Firestore (`agents` collection).
4. Paste `firestore.rules` (in this folder) into Firebase Console → Firestore Database → Rules →
   Publish. Without this, a fresh Firestore database defaults to either fully open ("test mode")
   or fully closed rules — the checked-in rules require `request.auth != null`, which is enough to
   block the open internet given step 3.
5. `npm run dev`. On first load, if the `agents` collection is empty, the app seeds it once with
   the sample roster (Ravi S, Abhinaya M, Karthick G, Divya P, Priya N, Munees A) so login works
   immediately — edit or add to these for real from Supervisor → Team & access.

## Telephony & Calling (TeleCMI WebRTC)

TCC integrates with TeleCMI (`piopiyjs`) to provide an in-browser WebRTC softphone for agents directly inside the workspace.

### Safe Dialling Modes

Because TCC's default customer database contains generated sample users (`src/data/seed.ts`) with randomly generated phone numbers, clicking **"Call"** would ring random strangers across India if dialled live.

To protect developers and avoid toll charges, TCC enforces three dialling safety modes in [`src/lib/telephony.ts`](src/lib/telephony.ts):

| Mode | Configuration in `.env.local` | Behavior |
| :--- | :--- | :--- |
| **1. Test Redirect Mode** *(Default in Dev)* | `VITE_TELEPHONY_TEST_NUMBER=8270942966` | Every click-to-call action redirects to this specific mobile phone, regardless of which customer is being viewed. A yellow banner warns the agent: *"Test mode — every call rings 8270942966"*. |
| **2. Production Live Mode** | `VITE_TELEPHONY_LIVE=true`<br>`# VITE_TELEPHONY_TEST_NUMBER=` (leave unset) | **Production mode.** Dials each customer's real individual number (`user.phone`) directly from your TeleCMI trunk. The yellow banner disappears. |
| **3. Safety Lock** | Both unset / empty | Calling is disabled. A protective banner informs the agent that live dialling is locked to prevent ringing mock numbers. |

### How to Switch to Production Calling

When connecting TCC to real customer data (Firestore, Postgres, or your CRM API):

1. **Update `.env` (or production environment variables)**:
   ```bash
   # Enable live customer calling
   VITE_TELEPHONY_LIVE=true

   # Comment out or remove the test redirect
   # VITE_TELEPHONY_TEST_NUMBER=

   # TeleCMI Configuration
   VITE_TELEPHONY_PROVIDER=telecmi
   VITE_TELECMI_APP_ID=33338836
   VITE_TELEPHONY_COUNTRY_CODE=91
   ```
2. **Customer Records (`user.phone`)**:
   - Ensure customer records have valid phone numbers (e.g. `+919876543210` or standard 10-digit Indian numbers).
   - TCC automatically sanitizes spaces, hyphens, and formats to E.164 (`+91...`) via [`src/telephony/core/phone-number.ts`](src/telephony/core/phone-number.ts).
3. **TeleCMI Virtual Number (Outbound Caller ID)**:
   - Ensure your TeleCMI dashboard (**Telephony → Numbers / Trunks**) has your registered virtual number assigned as the default outbound caller ID.
4. **Agent SIP Extensions**:
   - Each agent logs into their own TeleCMI SIP extension (e.g. `101_33338836`).
   - Store the extension on the agent profile (`agent.telecmiUserId`) in Firestore or [`src/data/seed.ts`](src/data/seed.ts) so login credentials auto-fill.

### Audio & Microphone Routing

- **Virtual Input Guard**: If the browser's default audio input is a virtual device (e.g. BlackHole, Iriun, Teams Audio) that captures 0 dB silence, TCC automatically detects it and swaps to the machine's real hardware microphone.
- **Hardware AEC / AGC**: All microphone streams request native `echoCancellation: true`, `noiseSuppression: true`, and `autoGainControl: true` on macOS/Windows.
- **Pre-Call Mic Level Meter**: Agents can verify their microphone level under **🎙️ Mic / Audio → Test Mic Level** before placing a call. During an active call, the meter shuts down to avoid audio stream contention and preserve 100% WebRTC uplink performance.

### Call Recordings & Post-Call Analytics

- **Cloud Recordings**: Answered calls are recorded on TeleCMI. Once a call ends, TCC queries TeleCMI's `out_cdr` endpoint using the agent's REST session token to retrieve the recording file and streamable URL.
- **Local Transcription Sidecar**: A local Whisper sidecar server (`tools/transcribe/server.py`) is provided for transcription testing.
- **Enterprise Webhook Pipeline**: In production, TeleCMI CDR webhooks stream dual-channel audio to automated speech-to-text engines (see [`docs/TELECMI_ENTERPRISE_SPEC.md`](docs/TELECMI_ENTERPRISE_SPEC.md)).

## Known limitation

The India map fetches its country outline from a CDN (`cdn.jsdelivr.net`) at runtime, same as the
original design's `india-map.html`. If that's unreachable (e.g. a locked-down network), the map
falls back to showing nothing but the state table next to it still has full data.

## Scale note

The design's headline numbers (11,842 total users, etc.) describe the full production system this
mirrors. This build generates 810 detailed sample user records — enough to populate every queue,
table, and chart with real, consistent, drill-into-able data — rather than literally instantiating
tens of thousands of rows.
