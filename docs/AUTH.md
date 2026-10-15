# Sign-in and access

Everyone signs in with their own Firebase Auth login (work email + password). What they may do comes from
`firestore.rules`, which looks the login up in two collections that only admins can write:

| Collection | Holds | Written by |
|---|---|---|
| `authLinks/{uid}` | `{ agentId }` — which TCC person this login is | admins |
| `agents/{agentId}` | role, status, apps, queues … | admins (people may stamp their own `lastActiveLabel`) |

A login with no link, or whose person is suspended, can read and write nothing. Agents work customers but cannot
change people, links, ownership or escalation decisions; supervisors and admins can. The change log is read-only
history: anyone can add a line as themselves, nobody can edit or delete one.

The local demo store (no `VITE_FIREBASE_*` set) has no real sign-in and keeps its data in the browser. Never use
that build for real customers.

## One-time setup of a Firebase project

1. Authentication › Sign-in method: **enable Email/Password, disable Anonymous.**
2. Authentication › Settings › Authorized domains: add the production domain.
3. Authentication › Templates: set the sender name, and the password-reset link text (this is the invite email).
4. Publish the rules: `firebase deploy --only firestore:rules`.
5. Create the first admin by hand (nobody else can, by design):
   - Authentication › Users › Add user: their email and a temporary password. Copy the **User UID**.
   - Firestore › `agents` › add document `owner` with: `name`, `username`, `email`, `role: "admin"`, `status: "active"`,
     `apps` (array: realbroks, irondrobe, influnet, vehigo), `queues: []`, `languages: ["English"]`, `states: []`,
     `dailyTarget: 0`, `clickToDial: true`, `lastActiveLabel: "Never"`, the `today*` counters as `0`,
     `avgHandleLabel: "—"`, `workingQueueLabel: "—"`.
   - Firestore › `authLinks` › add document with ID = the UID, field `agentId: "owner"`.
6. Sign in, then add everyone else from **People & access** — it creates their login, links it, and emails them a
   link to choose a password. Nobody, including the admin, ever sees a password.

The sample roster is no longer written to a live database. Remove any old sample `agents` documents.

## Testing without touching a real project

```bash
npm run emulators                           # Auth + Firestore on this machine (needs Java 11+)
node tools/emulator/seed-admin.mjs          # an admin login, agent record and link
# run the app with: VITE_FIREBASE_API_KEY=x VITE_FIREBASE_PROJECT_ID=tcc-local VITE_FIREBASE_EMULATOR=true npm run dev
npm run test:rules                          # the Firestore rules, against the emulator
```

## Known limits

- Anyone can call Firebase's public sign-up endpoint with the app's API key and create a login, but without an
  `authLinks` document it grants nothing. Moving account creation into a backend (Admin SDK) closes that too.
- Admins cannot set another person's password; people reset their own from the sign-in page.
- If creating the login succeeds but linking it fails, the login is orphaned; link it by hand in the console.
- Overlay writes (call logs, tickets) are open to every active person; the rules only guard ownership changes.
