// Local only: creates one admin login + its agent record + link in the running emulators (npm run emulators).
//   node tools/emulator/seed-admin.mjs [email] [password]
const email = process.argv[2] ?? 'owner@tcc.test';
const password = process.argv[3] ?? 'local-only-pass-1';
const project = 'tcc-local';

const signUp = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
}).then((r) => r.json());
if (!signUp.localId) throw new Error(`could not create login: ${JSON.stringify(signUp)}`);

const put = (path, fields) =>
  fetch(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  }).then((r) => r.ok || Promise.reject(new Error(`${path}: ${r.status}`)));
const str = (v) => ({ stringValue: v });
const arr = (xs) => ({ arrayValue: { values: xs.map(str) } });

await put('agents/owner-1', {
  name: str('Owner'), username: str('owner'), email: str(email), role: str('admin'), status: str('active'),
  apps: arr(['realbroks', 'irondrobe', 'influnet', 'vehigo']), queues: arr([]), languages: arr(['English']), states: arr([]),
  dailyTarget: { integerValue: '0' }, clickToDial: { booleanValue: true }, lastActiveLabel: str('Never'),
  todayCalls: { integerValue: '0' }, todayConnected: { integerValue: '0' }, todayPositive: { integerValue: '0' },
  todaySubscribed: { integerValue: '0' }, todayOverdue: { integerValue: '0' }, avgHandleLabel: str('—'), workingQueueLabel: str('—'),
});
await put(`authLinks/${signUp.localId}`, { agentId: str('owner-1') });
console.log(`Seeded admin ${email} (password: ${password})`);
