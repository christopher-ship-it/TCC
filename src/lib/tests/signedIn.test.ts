import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ONLINE_MINUTES, canSignOut, isOnline } from '../signedIn.ts';

const NOW = Date.now();
const p = (id: string, role: string, apps: string[], superAdmin = false) => ({ id, role, apps, superAdmin });

test('online means a signed-in session the server heard from in the last 15 minutes', () => {
  assert.equal(isOnline(NOW - 60_000, 1, NOW), true);
  assert.equal(isOnline(NOW - (ONLINE_MINUTES + 1) * 60_000, 1, NOW), false);
  assert.equal(isOnline(NOW - 1000, 0, NOW), false, 'signed out');
  assert.equal(isOnline(null, 1, NOW), false);
});

test('an admin signs out their own agents and supervisors, never another admin or the super admin', () => {
  const admin = p('a1', 'admin', ['irondrobe', 'realbroks']);
  assert.equal(canSignOut(admin, p('x', 'agent', ['irondrobe'])), true);
  assert.equal(canSignOut(admin, p('x', 'supervisor', ['realbroks'])), true);
  assert.equal(canSignOut(admin, p('x', 'admin', ['irondrobe'])), false);
  assert.equal(canSignOut(admin, p('s', 'admin', ['irondrobe'], true)), false);
  assert.equal(canSignOut(admin, p('x', 'agent', ['vehigo'])), false, 'a product they do not run');
  assert.equal(canSignOut(admin, admin), false, 'not themselves');
});

test('agents and supervisors cannot sign anyone out; the super admin can sign out anyone else', () => {
  assert.equal(canSignOut(p('s1', 'supervisor', ['irondrobe']), p('x', 'agent', ['irondrobe'])), false);
  assert.equal(canSignOut(p('g', 'agent', ['irondrobe']), p('x', 'agent', ['irondrobe'])), false);
  const sa = p('sa', 'admin', [], true);
  assert.equal(canSignOut(sa, p('x', 'admin', ['irondrobe'])), true);
  assert.equal(canSignOut(sa, sa), false);
});
