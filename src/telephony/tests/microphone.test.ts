import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acquireMicrophone, choosePreferredInput, explicitDeviceId, isVirtualInput, type InputDevice, type MediaDevicesLike } from '../core/microphone.ts';

// The input list Chrome reported on the machine where the one-way-audio bug was found.
const MAC: InputDevice[] = [
  { deviceId: 'bcc31f0d', label: 'BlackHole 2ch (Virtual)' },
  { deviceId: 'c856c712', label: 'MacBook Air Microphone (Built-in)' },
  { deviceId: '0e803e66', label: 'Microsoft Teams Audio Device (Virtual)' },
  { deviceId: 'b9fc9487', label: 'Iriun Mic #0 (Virtual)' },
  { deviceId: 'default', label: 'Default - MacBook Air Microphone (Built-in)' },
];

test('virtual / routing inputs are recognised, real ones are not', () => {
  for (const l of ['BlackHole 2ch (Virtual)', 'Microsoft Teams Audio Device (Virtual)', 'Iriun Mic #0 (Virtual)', 'Multi-Output Device (Aggregate)', 'Soundflower (2ch)', 'VB-Cable', 'OBS Virtual Audio', 'Krisp Microphone']) {
    assert.equal(isVirtualInput(l), true, l);
  }
  for (const l of ['MacBook Air Microphone (Built-in)', 'Default - MacBook Air Microphone (Built-in)', 'USB Audio Device', 'AirPods Pro', 'Logitech Webcam C920', 'Microphone Array (Realtek)', '']) {
    assert.equal(isVirtualInput(l), false, l);
  }
});

test('picks the built-in mic over virtual devices, ignoring the "default" pseudo-entry', () => {
  assert.equal(choosePreferredInput(MAC)?.deviceId, 'c856c712');
});

test('a saved choice wins while it still exists; a stale one is ignored', () => {
  assert.equal(choosePreferredInput([...MAC, { deviceId: 'usb1', label: 'USB Audio Device' }], 'usb1')?.deviceId, 'usb1');
  assert.equal(choosePreferredInput(MAC, 'bcc31f0d')?.deviceId, 'bcc31f0d'); // explicit choice respected even if virtual
  assert.equal(choosePreferredInput(MAC, 'gone')?.deviceId, 'c856c712');
});

test('prefers built-in, then any real mic; null when only virtual devices exist', () => {
  assert.equal(choosePreferredInput([{ deviceId: 'a', label: 'USB Audio Device' }, { deviceId: 'b', label: 'MacBook Pro Microphone' }])?.deviceId, 'b');
  assert.equal(choosePreferredInput([{ deviceId: 'a', label: 'USB Audio Device' }])?.deviceId, 'a');
  assert.equal(choosePreferredInput([{ deviceId: 'a', label: 'BlackHole 2ch (Virtual)' }]), null);
  assert.equal(choosePreferredInput([]), null);
  // Before the first permission grant Chrome hides names — never pick blindly among nameless devices.
  assert.equal(choosePreferredInput(MAC.map((d) => ({ ...d, label: '' }))), null);
});

test('explicitDeviceId reads string / exact / ideal / array forms and ignores "default"', () => {
  assert.equal(explicitDeviceId(true), null);
  assert.equal(explicitDeviceId({}), null);
  assert.equal(explicitDeviceId({ deviceId: 'abc' }), 'abc');
  assert.equal(explicitDeviceId({ deviceId: { exact: 'abc' } }), 'abc');
  assert.equal(explicitDeviceId({ deviceId: { ideal: ['abc', 'x'] } }), 'abc');
  assert.equal(explicitDeviceId({ deviceId: 'default' }), null);
  assert.equal(explicitDeviceId({ deviceId: { exact: 'communications' } }), null);
});

// --- acquireMicrophone against a fake browser -------------------------------------------------

function fakeStream(label: string) {
  const track = { label, stopped: false, stop() { this.stopped = true; } };
  return { track, getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream & { track: { stopped: boolean } };
}

/** `defaultLabel` is what audio:true resolves to; devices become labelled only after the first grant when `labelsAfterGrant`. */
function fakeBrowser(opts: { devices: InputDevice[]; defaultLabel: string; labelsAfterGrant?: boolean; failExact?: boolean }) {
  const calls: MediaStreamConstraints[] = [];
  const streams: (MediaStream & { track: { stopped: boolean } })[] = [];
  let granted = !opts.labelsAfterGrant;
  const md: MediaDevicesLike = {
    async getUserMedia(c) {
      calls.push(c ?? {});
      const audio = c?.audio;
      const exact = audio && typeof audio === 'object' ? (audio.deviceId as { exact?: string } | string | undefined) : undefined;
      const id = typeof exact === 'string' ? exact : exact?.exact;
      granted = true;
      if (id) {
        if (opts.failExact) throw Object.assign(new Error('nope'), { name: 'OverconstrainedError' });
        const dev = opts.devices.find((d) => d.deviceId === id);
        if (!dev) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        const s = fakeStream(dev.label);
        streams.push(s);
        return s;
      }
      const s = fakeStream(opts.defaultLabel);
      streams.push(s);
      return s;
    },
    async enumerateDevices() {
      return opts.devices.map((d) => ({ deviceId: d.deviceId, label: granted ? d.label : '', kind: 'audioinput' }) as MediaDeviceInfo);
    },
  };
  return { md, calls, streams };
}

test('default is BlackHole → the call captures the built-in mic instead (the reported bug)', async () => {
  const b = fakeBrowser({ devices: MAC, defaultLabel: 'BlackHole 2ch (Virtual)' });
  const mic = await acquireMicrophone(b.md, { audio: true, video: false });
  assert.equal(mic.label, 'MacBook Air Microphone (Built-in)');
  assert.equal(mic.replacedVirtual, false); // chosen up front, never opened the virtual one
  assert.deepEqual((b.calls[0].audio as MediaTrackConstraints).deviceId, { exact: 'c856c712' });
  assert.equal(b.calls.length, 1);
});

test('first ever call (labels hidden until permission): opens the default, sees it is virtual, swaps and releases it', async () => {
  const b = fakeBrowser({ devices: MAC, defaultLabel: 'BlackHole 2ch (Virtual)', labelsAfterGrant: true });
  const mic = await acquireMicrophone(b.md, { audio: true });
  assert.equal(mic.label, 'MacBook Air Microphone (Built-in)');
  assert.equal(mic.replacedVirtual, true);
  assert.equal(b.streams[0].track.stopped, true); // the silent virtual stream was released
  assert.equal(b.streams[1].track.stopped, false);
});

test('an explicit device is honoured as-is, even a virtual one', async () => {
  const b = fakeBrowser({ devices: MAC, defaultLabel: 'BlackHole 2ch (Virtual)' });
  const mic = await acquireMicrophone(b.md, { audio: { deviceId: 'b9fc9487' } });
  assert.equal(mic.label, 'Iriun Mic #0 (Virtual)');
  assert.equal(b.calls.length, 1);
});

test('a healthy default is left alone', async () => {
  const devices = [{ deviceId: 'u', label: 'USB Audio Device' }];
  const b = fakeBrowser({ devices, defaultLabel: 'USB Audio Device' });
  const mic = await acquireMicrophone(b.md, { audio: true });
  assert.equal(mic.label, 'USB Audio Device');
});

test('if the chosen device cannot be opened, fall back to the browser default rather than failing the call', async () => {
  const b = fakeBrowser({ devices: MAC, defaultLabel: 'BlackHole 2ch (Virtual)', failExact: true });
  const mic = await acquireMicrophone(b.md, { audio: true });
  assert.equal(mic.label, 'BlackHole 2ch (Virtual)'); // best effort — same as before this fix
  assert.equal(mic.replacedVirtual, false);
});

test('only virtual inputs exist → default is returned unchanged', async () => {
  const b = fakeBrowser({ devices: [{ deviceId: 'a', label: 'BlackHole 2ch (Virtual)' }], defaultLabel: 'BlackHole 2ch (Virtual)' });
  const mic = await acquireMicrophone(b.md, { audio: true });
  assert.equal(mic.label, 'BlackHole 2ch (Virtual)');
});

test('other constraints (echo cancellation etc.) survive the device pin', async () => {
  const b = fakeBrowser({ devices: MAC, defaultLabel: 'BlackHole 2ch (Virtual)' });
  await acquireMicrophone(b.md, { audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  const audio = b.calls[0].audio as MediaTrackConstraints;
  assert.equal(audio.echoCancellation, true);
  assert.equal(audio.noiseSuppression, true);
  assert.equal(b.calls[0].video, false);
});
