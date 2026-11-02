import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDial, type DialEnv } from '../dialPolicy.ts';

const real = { id: 'cust-919876543210', phone: '+919876543210', origin: 'app' as const };
const sample = { id: 'u-realbroks-1', phone: '+919111111111', origin: 'sample' as const };
const typed = { id: 'adhoc-919800000000', phone: '+919800000000', origin: 'tcc' as const, adHoc: true };
const typedByDemo = { id: 'demo-adhoc-919800000000', phone: '+919800000000', origin: 'sample' as const, adHoc: true };

const prod: DialEnv = { provider: 'telecmi', testNumber: null, live: true };
const testMode: DialEnv = { provider: 'telecmi', testNumber: '8270942966', live: false };
const locked: DialEnv = { provider: 'telecmi', testNumber: null, live: false };

test('in production a real agent dials the real customer', () => {
  assert.deepEqual(planDial(real, {}, prod), { mode: 'live', number: '+919876543210' });
});

test('in production a demo account can still never ring a customer', () => {
  assert.equal(planDial(real, { demo: true }, prod).mode, 'blocked');
  assert.equal(planDial(sample, { demo: true }, prod).mode, 'blocked');
  assert.equal(planDial(typedByDemo, { demo: true }, prod).mode, 'blocked');
});

test('a demo account rings only the test line when one is set — customer or typed number alike', () => {
  for (const c of [real, sample, typedByDemo]) {
    const p = planDial(c, { demo: true }, testMode);
    assert.equal(p.mode, 'redirect');
    assert.equal(p.mode === 'redirect' && p.number, '8270942966');
  }
});

test('a made-up customer is never dialled for real, whoever is calling', () => {
  assert.equal(planDial(sample, {}, prod).mode, 'blocked');
  assert.equal(planDial(sample, {}, locked).mode, 'blocked');
});

test('test mode redirects real customers but dials a number the agent typed', () => {
  assert.equal(planDial(real, {}, testMode).mode, 'redirect');
  assert.deepEqual(planDial(typed, {}, testMode), { mode: 'live', number: '+919800000000' });
});

test('with live dialling off, customers are locked but a typed number is allowed', () => {
  assert.equal(planDial(real, {}, locked).mode, 'blocked');
  assert.equal(planDial(typed, {}, locked).mode, 'live');
});

test('the demo line never dials anyone, so everyone may use it', () => {
  const mock: DialEnv = { provider: 'mock', testNumber: null, live: false };
  assert.equal(planDial(sample, { demo: true }, mock).mode, 'live');
  assert.equal(planDial(real, {}, mock).mode, 'live');
});

test('without browser calling, a demo account gets no phone link to a stranger', () => {
  const none: DialEnv = { provider: null, testNumber: null, live: false };
  assert.equal(planDial(sample, { demo: true }, none).mode, 'blocked');
  assert.equal(planDial(real, {}, none).mode, 'live');
});
