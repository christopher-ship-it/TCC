import { PhoneController } from '../core/controller.ts';
import { MockProvider, type MockOptions } from '../providers/mock.ts';

/** Deterministic clock + scheduler: nothing happens until advance() is called. */
export function manualClock(start = 1_700_000_000_000) {
  let t = start;
  const queue: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    schedule(fn: () => void, ms: number) {
      const item = { at: t + ms, fn };
      queue.push(item);
      return () => {
        const i = queue.indexOf(item);
        if (i >= 0) queue.splice(i, 1);
      };
    },
    advance(ms: number) {
      const target = t + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > target) break;
        queue.shift();
        t = next.at;
        next.fn();
      }
      t = target;
    },
  };
}

export function setup(opts: MockOptions = {}, controllerOpts: { hangupGraceMs?: number } = {}) {
  const clock = manualClock();
  const provider = new MockProvider({ schedule: clock.schedule, ...opts });
  const controller = new PhoneController({ provider, now: clock.now, newId: () => 'call-1', ...controllerOpts });
  controller.start();
  controller.connect({ userId: 'u', password: 'p' });
  clock.advance(1000); // let the mock "log in"
  return { clock, provider, controller };
}
