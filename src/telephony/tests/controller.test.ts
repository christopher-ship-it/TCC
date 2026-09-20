import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhoneController } from '../core/controller.ts';
import type { CallResult, ProviderEvent, TelephonyProvider } from '../core/types.ts';
import { setup } from './helpers.ts';

test('starts disconnected, becomes ready after login', () => {
  const { controller } = setup();
  assert.equal(controller.getSnapshot().connection, 'ready');
});

test('bad credentials surface as a failed connection', () => {
  const { clock, controller } = setup();
  controller.disconnect();
  controller.connect({ userId: 'u', password: 'bad' });
  clock.advance(1000);
  const s = controller.getSnapshot();
  assert.equal(s.connection, 'failed');
  assert.equal(s.connectionError?.code, 401);
});

test('dial is refused when not ready, invalid, or already on a call', () => {
  const { clock, controller } = setup();
  assert.deepEqual(controller.dial('12'), { ok: false, reason: 'invalid-number' });
  assert.equal(controller.dial('9876543210').ok, true);
  assert.deepEqual(controller.dial('9876543210'), { ok: false, reason: 'call-in-progress' });
  controller.hangup();
  clock.advance(10);
  controller.disconnect();
  assert.deepEqual(controller.dial('9876543210'), { ok: false, reason: 'not-ready' });
});

test('answered call: dialing → ringing → connected → completed, with tags and durations', () => {
  const { clock, provider, controller } = setup({ ringMs: 2000 });
  const ended: CallResult[] = [];
  controller.onCallEnded((r) => ended.push(r));

  assert.equal(controller.dial('+91 98765 43210', { customerId: 'c1' }).ok, true);
  assert.equal(controller.getSnapshot().call?.state, 'dialing');
  assert.deepEqual(provider.dialed[0], { to: '919876543210', meta: { customerId: 'c1' } });

  clock.advance(300);
  assert.equal(controller.getSnapshot().call?.state, 'ringing');
  clock.advance(1700);
  assert.equal(controller.getSnapshot().call?.state, 'connected');
  assert.equal(controller.getSnapshot().call?.providerCallId, 'mock-1');

  clock.advance(65_000);
  controller.hangup();

  assert.equal(controller.getSnapshot().call, null);
  assert.equal(ended.length, 1);
  const r = ended[0];
  assert.equal(r.disposition, 'connected');
  assert.equal(r.talkSeconds, 65);
  assert.equal(r.ringSeconds, 2);
  assert.deepEqual(r.meta, { customerId: 'c1' });
  assert.equal(r.provider, 'mock');
  assert.equal(r.providerCallId, 'mock-1');
  assert.equal(controller.getSnapshot().lastResult, r);
});

test('every unanswered scenario maps to the right disposition', () => {
  const cases: [string, string][] = [
    ['9876543211', 'no-answer'],
    ['9876543212', 'busy'],
    ['9876543213', 'unreachable'],
    ['9876543214', 'unreachable'],
    ['9876543215', 'rejected'],
  ];
  for (const [number, expected] of cases) {
    const { clock, controller } = setup({ ringMs: 1000 });
    controller.dial(number);
    clock.advance(10_000);
    const s = controller.getSnapshot();
    assert.equal(s.call, null, number);
    assert.equal(s.lastResult?.disposition, expected, number);
    assert.equal(s.lastResult?.talkSeconds, 0, number);
  }
});

test('hanging up while it rings is "cancelled", not "no answer"', () => {
  const { clock, controller } = setup();
  controller.dial('9876543210');
  clock.advance(400); // ringing
  controller.hangup();
  assert.equal(controller.getSnapshot().lastResult?.disposition, 'cancelled');
});

test('mute is optimistic; hold flips when the provider confirms; controls only work when connected', () => {
  const { clock, provider, controller } = setup({ ringMs: 500 });
  controller.dial('9876543210');
  controller.toggleMute(); // still dialing → ignored
  controller.toggleHold();
  assert.equal(controller.getSnapshot().call?.muted, false);
  assert.equal(provider.isHeld, false);

  clock.advance(600);
  controller.toggleMute();
  assert.equal(controller.getSnapshot().call?.muted, true);
  controller.toggleMute();
  assert.equal(controller.getSnapshot().call?.muted, false);
  controller.toggleHold();
  assert.equal(controller.getSnapshot().call?.held, true);
  controller.toggleHold();
  assert.equal(controller.getSnapshot().call?.held, false);
});

test('DTMF only accepts keypad characters', () => {
  const { clock, provider, controller } = setup({ ringMs: 500 });
  controller.dial('9876543210');
  clock.advance(600);
  for (const k of ['1', '#', '*', 'x', '12', '']) controller.sendDtmf(k);
  assert.deepEqual(provider.sentDtmf, ['1', '#', '*']);
});

test('inbound: incoming → answer → connected; decline → rejected', () => {
  const a = setup();
  a.provider.simulateIncoming('Ravi', 'Sales');
  assert.equal(a.controller.getSnapshot().call?.state, 'incoming');
  assert.equal(a.controller.getSnapshot().call?.direction, 'inbound');
  a.controller.answer();
  assert.equal(a.controller.getSnapshot().call?.state, 'connected');

  const b = setup();
  b.provider.simulateIncoming('Ravi');
  b.controller.hangup();
  assert.equal(b.controller.getSnapshot().lastResult?.disposition, 'rejected');
});

test('a second inbound call while busy is ignored', () => {
  const { provider, controller } = setup();
  controller.dial('9876543210');
  provider.simulateIncoming('Someone');
  assert.equal(controller.getSnapshot().call?.direction, 'outbound');
});

test('provider error before ringing fails the call instead of leaving it stuck dialing', () => {
  const events: ((e: ProviderEvent) => void)[] = [];
  const stub: TelephonyProvider = {
    name: 'stub', requiresCredentials: false,
    connect() {}, disconnect() {}, answer() {}, reject() {}, hangup() {}, mute() {}, hold() {}, sendDtmf() {},
    dial() { events.forEach((h) => h({ type: 'error', code: 1002, message: 'Please login to call' })); },
    getCallId: () => null,
    subscribe(h) { events.push(h); return () => {}; },
  };
  const c = new PhoneController({ provider: stub });
  c.start();
  events.forEach((h) => h({ type: 'ready' }));
  assert.equal(c.dial('9876543210').ok, true);
  const s = c.getSnapshot();
  assert.equal(s.call, null);
  assert.equal(s.lastResult?.disposition, 'failed');
  assert.equal(s.error?.code, 1002);
});

test('mediaFailed (mic denied) ends the call as failed with a message', () => {
  const events: ((e: ProviderEvent) => void)[] = [];
  const stub: TelephonyProvider = {
    name: 'stub', requiresCredentials: false,
    connect() {}, disconnect() {}, answer() {}, reject() {}, hangup() {}, mute() {}, hold() {}, sendDtmf() {},
    dial() { events.forEach((h) => h({ type: 'trying' })); events.forEach((h) => h({ type: 'mediaFailed', message: 'Permission denied' })); },
    getCallId: () => null,
    subscribe(h) { events.push(h); return () => {}; },
  };
  const c = new PhoneController({ provider: stub });
  c.start();
  events.forEach((h) => h({ type: 'ready' }));
  c.dial('9876543210');
  assert.equal(c.getSnapshot().lastResult?.disposition, 'failed');
  assert.equal(c.getSnapshot().error?.message, 'Permission denied');
});

test('watchdog: a hangup the provider never confirms still ends the call locally', async () => {
  const events: ((e: ProviderEvent) => void)[] = [];
  const stub: TelephonyProvider = {
    name: 'stub', requiresCredentials: false,
    connect() {}, disconnect() {}, answer() {}, reject() {}, hangup() {}, mute() {}, hold() {}, sendDtmf() {},
    dial() {}, getCallId: () => null,
    subscribe(h) { events.push(h); return () => {}; },
  };
  const c = new PhoneController({ provider: stub, hangupGraceMs: 20 });
  c.start();
  events.forEach((h) => h({ type: 'ready' }));
  c.dial('9876543210');
  c.hangup();
  assert.notEqual(c.getSnapshot().call, null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(c.getSnapshot().call, null);
  assert.equal(c.getSnapshot().lastResult?.disposition, 'cancelled');
});

test('the SDK emitting "answered" twice does not reset the answer time', () => {
  const events: ((e: ProviderEvent) => void)[] = [];
  let now = 1000;
  const stub: TelephonyProvider = {
    name: 'stub', requiresCredentials: false,
    connect() {}, disconnect() {}, answer() {}, reject() {}, hangup() {}, mute() {}, hold() {}, sendDtmf() {},
    dial() {}, getCallId: () => null,
    subscribe(h) { events.push(h); return () => {}; },
  };
  const c = new PhoneController({ provider: stub, now: () => now });
  c.start();
  events.forEach((h) => h({ type: 'ready' }));
  c.dial('9876543210');
  events.forEach((h) => h({ type: 'answered' }));
  const first = c.getSnapshot().call?.answeredAt;
  now = 9000;
  events.forEach((h) => h({ type: 'answered' }));
  assert.equal(c.getSnapshot().call?.answeredAt, first);
});

test('stats samples attach to the live call and freeze into the final result', () => {
  const { clock, controller, dispatchStats } = setup({ ringMs: 1000, stats: { packetsSent: 50, packetsReceived: 50, roundTripSec: 0.04 } });
  const ended: CallResult[] = [];
  controller.onCallEnded((r) => ended.push(r));

  controller.dial('9876543210');
  clock.advance(1500); // answered + first stats tick at +500ms
  assert.equal(controller.getSnapshot().call?.state, 'connected');
  assert.equal(controller.getSnapshot().call?.stats?.packetsSent, 50);

  clock.advance(2000); // two more ticks: counters grow
  assert.equal(controller.getSnapshot().call?.stats?.packetsSent, 150);
  assert.equal(controller.getSnapshot().call?.stats?.packetsReceived, 150);

  controller.hangup();
  assert.equal(ended.length, 1);
  assert.equal(ended[0].stats?.packetsSent, 150);
  assert.equal(controller.getSnapshot().lastResult?.stats?.packetsReceived, 150);

  // A stats event for an old call (no call live) is ignored.
  dispatchStats();
  assert.equal(controller.getSnapshot().lastResult?.stats?.packetsSent, 150);
});

test('a dead-microphone stats sample is preserved in the result for diagnosis', () => {
  const { clock, controller } = setup({ ringMs: 500, stats: { packetsSent: 0, packetsReceived: 50 } });
  controller.dial('9876543210');
  clock.advance(1200); // answered at +500, one stats tick at +1000
  controller.hangup();
  const r = controller.getSnapshot().lastResult;
  assert.equal(r?.disposition, 'connected');
  assert.equal(r?.stats?.packetsSent, 0);
  assert.equal(r?.stats?.packetsReceived, 50);
});

test('snapshot identity is stable while nothing changes, and subscribers are notified on change', () => {
  const { clock, controller } = setup();
  let notified = 0;
  controller.subscribe(() => notified++);
  const before = controller.getSnapshot();
  controller.hangup(); // no call → no-op
  controller.clearError(); // no error → no-op
  assert.equal(controller.getSnapshot(), before);
  assert.equal(notified, 0);
  controller.dial('9876543210');
  clock.advance(400);
  assert.ok(notified >= 2);
  assert.notEqual(controller.getSnapshot(), before);
});

test('stop() hangs up, signs out and detaches from the provider', () => {
  const { provider, controller } = setup();
  controller.dial('9876543210');
  controller.stop();
  assert.equal(controller.getSnapshot().call, null);
  assert.equal(controller.getSnapshot().connection, 'disconnected');
  // detached: further provider events don't change state
  const snap = controller.getSnapshot();
  provider.simulateIncoming('late');
  assert.equal(controller.getSnapshot(), snap);
});
