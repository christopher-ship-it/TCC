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

## Known limitation

The India map fetches its country outline from a CDN (`cdn.jsdelivr.net`) at runtime, same as the
original design's `india-map.html`. If that's unreachable (e.g. a locked-down network), the map
falls back to showing nothing but the state table next to it still has full data.

## Scale note

The design's headline numbers (11,842 total users, etc.) describe the full production system this
mirrors. This build generates 810 detailed sample user records — enough to populate every queue,
table, and chart with real, consistent, drill-into-able data — rather than literally instantiating
tens of thousands of rows.
