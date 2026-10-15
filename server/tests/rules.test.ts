// Firestore security rules, run against the local emulator:  npm run test:rules
// (needs Java; `npm test` skips this file's emulator work when FIRESTORE_EMULATOR_HOST is not set.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, addDoc, collection } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST;

describe('firestore.rules', { skip: !host }, () => {
  let env: RulesTestEnvironment;

  before(async () => {
    const [h, port] = host!.split(':');
    env = await initializeTestEnvironment({ projectId: 'tcc-rules', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: h, port: Number(port) } });
  });
  after(async () => env?.cleanup());

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'agents/boss'), { role: 'admin', status: 'active' });
      await setDoc(doc(db, 'agents/lead'), { role: 'supervisor', status: 'active' });
      await setDoc(doc(db, 'agents/ravi'), { role: 'agent', status: 'active' });
      await setDoc(doc(db, 'agents/gone'), { role: 'agent', status: 'suspended' });
      await setDoc(doc(db, 'authLinks/u-boss'), { agentId: 'boss' });
      await setDoc(doc(db, 'authLinks/u-lead'), { agentId: 'lead' });
      await setDoc(doc(db, 'authLinks/u-ravi'), { agentId: 'ravi' });
      await setDoc(doc(db, 'authLinks/u-gone'), { agentId: 'gone' });
      await setDoc(doc(db, 'customerOverlay/c1'), { queue: 'new', ownerAgentId: 'ravi' });
      await setDoc(doc(db, 'escalations/e1'), { status: 'pending' });
    });
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  test('signed-out and unlinked logins can read nothing', async () => {
    await assertFails(getDoc(doc(anon(), 'agents/ravi')));
    await assertFails(getDoc(doc(anon(), 'customerOverlay/c1')));
    await assertFails(getDoc(doc(as('stranger'), 'agents/ravi')));
    await assertFails(getDoc(doc(as('stranger'), 'customerOverlay/c1')));
    await assertFails(setDoc(doc(as('stranger'), 'customerOverlay/c1'), { queue: 'x' }, { merge: true }));
  });

  test('a login can read its own link and nobody else’s', async () => {
    await assertSucceeds(getDoc(doc(as('u-ravi'), 'authLinks/u-ravi')));
    await assertFails(getDoc(doc(as('u-ravi'), 'authLinks/u-boss')));
    await assertFails(getDoc(doc(as('stranger'), 'authLinks/u-boss')));
  });

  test('a suspended person is locked out even with a valid login', async () => {
    await assertSucceeds(getDoc(doc(as('u-gone'), 'authLinks/u-gone')));
    await assertFails(getDoc(doc(as('u-gone'), 'customerOverlay/c1')));
    await assertFails(getDoc(doc(as('u-gone'), 'agents/ravi')));
  });

  test('agents work customers but cannot touch people, links or ownership', async () => {
    const db = as('u-ravi');
    await assertSucceeds(getDoc(doc(db, 'agents/boss')));
    await assertSucceeds(setDoc(doc(db, 'customerOverlay/c1'), { queue: 'followup', attempt: 2 }, { merge: true }));
    await assertFails(setDoc(doc(db, 'customerOverlay/c1'), { ownerAgentId: 'ravi-friend' }, { merge: true }));
    await assertFails(updateDoc(doc(db, 'agents/ravi'), { role: 'admin' }));
    await assertFails(setDoc(doc(db, 'agents/new'), { role: 'admin', status: 'active' }));
    await assertFails(setDoc(doc(db, 'authLinks/u-ravi'), { agentId: 'boss' }));
    await assertSucceeds(updateDoc(doc(db, 'agents/ravi'), { lastActiveLabel: 'now' }));
    await assertFails(updateDoc(doc(db, 'agents/boss'), { lastActiveLabel: 'now' }));
  });

  test('agents raise escalations but cannot decide them; leads can', async () => {
    await assertSucceeds(setDoc(doc(as('u-ravi'), 'escalations/e2'), { status: 'pending' }));
    await assertFails(updateDoc(doc(as('u-ravi'), 'escalations/e1'), { status: 'approved' }));
    await assertSucceeds(updateDoc(doc(as('u-lead'), 'escalations/e1'), { status: 'approved' }));
  });

  test('only leads reassign owners', async () => {
    await assertSucceeds(setDoc(doc(as('u-lead'), 'customerOverlay/c1'), { ownerAgentId: 'ravi-friend' }, { merge: true }));
  });

  test('customers: only admins import; an agent may add a dialled number', async () => {
    await assertFails(setDoc(doc(as('u-ravi'), 'customersMaster/real'), { name: 'X' }));
    await assertSucceeds(setDoc(doc(as('u-ravi'), 'customersMaster/adhoc-1'), { name: '+91', adHoc: true }));
    await assertFails(setDoc(doc(as('u-ravi'), 'customersMaster/adhoc-1'), { name: 'renamed', adHoc: true }));
    await assertSucceeds(setDoc(doc(as('u-boss'), 'customersMaster/real'), { name: 'X' }));
  });

  test('admins manage people and links', async () => {
    const db = as('u-boss');
    await assertSucceeds(setDoc(doc(db, 'agents/new'), { role: 'agent', status: 'active' }));
    await assertSucceeds(setDoc(doc(db, 'authLinks/u-new'), { agentId: 'new' }));
    await assertSucceeds(updateDoc(doc(db, 'agents/ravi'), { status: 'suspended' }));
  });

  test('change log: leads read it, anyone adds lines as themselves, nobody edits it', async () => {
    const line = (actorId: string) => ({ actorId, action: 'signed_in', ts: 1 });
    await assertSucceeds(addDoc(collection(as('u-ravi'), 'audit'), line('ravi')));
    await assertFails(addDoc(collection(as('u-ravi'), 'audit'), line('boss')));
    await assertFails(getDoc(doc(as('u-ravi'), 'audit/x')));
    await assertSucceeds(getDoc(doc(as('u-lead'), 'audit/x')));
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'audit/a1'), line('ravi')));
    await assertFails(updateDoc(doc(as('u-boss'), 'audit/a1'), { detail: 'edited' }));
    await assertFails(deleteDoc(doc(as('u-boss'), 'audit/a1')));
  });

  test('unknown collections are closed', async () => {
    await assertFails(getDoc(doc(as('u-boss'), 'secrets/x')));
    assert.ok(true);
  });
});
