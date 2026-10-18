import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseAnalysis } from '../../src/lib/analysis/model.ts';
import { attributeSpeakers, speakingBlocks, talkShare, type LevelSample } from '../../src/lib/analysis/speakers.ts';
import { analyzeRecording, NotConfigured } from '../analyze.ts';
import { createApi } from '../api.ts';
import { readServerEnv } from '../env.ts';
import { fetchRecording, recordingSources, sniffAudio } from '../recordings.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcc-server-'));
const wav = () => {
  const b = new Uint8Array(4000);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
  return b;
};
const env = (extra: Record<string, string> = {}) => readServerEnv({ VITE_TELECMI_APP_ID: '33338836', TELECMI_APP_SECRET: 's3cret', GEMINI_API_KEY: 'k', ...extra }, tmp());

test('sniffs audio by its first bytes, not its headers', () => {
  assert.equal(sniffAudio(wav()), 'audio/wav');
  assert.equal(sniffAudio(new TextEncoder().encode('ID3abc')), 'audio/mpeg');
  assert.equal(sniffAudio(new TextEncoder().encode('<html>login')), null);
});

test('recording sources refuse anything but a bare file name', () => {
  assert.throws(() => recordingSources('../etc/passwd', env()));
  assert.throws(() => recordingSources('https://evil.example/x.mp3', env()));
  const urls = recordingSources('abc_123.mp3', env());
  assert.ok(urls[0].startsWith('https://rest.telecmi.com/v2/play?'));
  assert.ok(urls.at(-1)!.includes('connly_voice/download_music/abc_123.mp3'));
});

test('a carrier error page is reported without leaking the secret, and audio is cached', async () => {
  const e = env();
  const htmlOnly = (async () => new Response('<html>please log in</html>', { status: 200 })) as typeof fetch;
  await assert.rejects(fetchRecording('a.mp3', e, htmlOnly), (err: Error) => !err.message.includes('s3cret') && !/telecmi/i.test(err.message) && !err.message.includes('please log in'));

  let calls = 0;
  const ok = (async () => {
    calls++;
    return new Response(wav(), { status: 200 });
  }) as typeof fetch;
  const first = await fetchRecording('b.mp3', e, ok);
  const second = await fetchRecording('b.mp3', e, ok);
  assert.equal(first.contentType, 'audio/wav');
  assert.equal(second.data.byteLength, 4000);
  assert.equal(calls, 1);
});

test('parses fenced model JSON into TCC analysis vocabulary', () => {
  const a = parseAnalysis(
    '```json\n{"outcome":"Interested","summary":"She wants help.","keyPoints":["photos"],"sentiment":140,"languages":["Tamil"],"transcript":[{"speaker":"Agent","at":"00:02","text":"Vanakkam"},{"speaker":"Customer","at":"01:05","text":"Sollunga"}]}\n```',
    'gemini-test',
    1,
  );
  assert.equal(a.outcome, 'Interested');
  assert.equal(a.sentiment, 100);
  assert.deepEqual(a.transcript.map((l) => [l.speaker, l.atSec]), [['agent', 2], ['customer', 65]]);
  assert.throws(() => parseAnalysis('not json', 'm'));
});

test('speaker labels follow the measured levels, not the model', () => {
  const levels: LevelSample[] = [];
  for (let t = 1; t <= 10; t++) levels.push([t, t <= 5 ? 0.2 : 0.001, t <= 5 ? 0.001 : 0.2]);
  const lines = attributeSpeakers(
    [
      { speaker: 'customer', atSec: 0, text: 'hello' },
      { speaker: 'agent', atSec: 6, text: 'hi' },
    ],
    levels,
  );
  assert.deepEqual(lines.map((l) => l.speaker), ['agent', 'customer']);
  assert.deepEqual(speakingBlocks(levels).map((b) => b.speaker), ['agent', 'customer']);
  const share = talkShare(levels);
  assert.ok(share.measured && share.agent > 0 && share.customer > 0);
});

test('analysis without a Gemini key says what to configure; a cached result still serves', async () => {
  const e = readServerEnv({}, tmp());
  await assert.rejects(analyzeRecording({ file: 'x.mp3' }, e), NotConfigured);

  const withKey = env();
  let geminiCalls = 0;
  const fake = (async (url: string | URL | Request) => {
    if (String(url).includes('generativelanguage')) {
      geminiCalls++;
      const text = JSON.stringify({ outcome: 'Voicemail', summary: 'Voicemail.', sentiment: 50, transcript: [] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }
    return new Response(wav(), { status: 200 });
  }) as typeof fetch;
  const a = await analyzeRecording({ file: 'v.mp3' }, withKey, fake);
  const b = await analyzeRecording({ file: 'v.mp3' }, withKey, fake);
  assert.equal(a.outcome, 'Voicemail');
  assert.equal(b.outcome, 'Voicemail');
  assert.equal(geminiCalls, 1);
});

test('api refuses cross-site requests and reports health', async () => {
  const api = createApi(readServerEnv({ GEMINI_API_KEY: 'k' }, tmp()));
  const run = (headers: Record<string, string>) =>
    new Promise<{ status: number; body: string }>((resolve) => {
      const req = { url: '/api/health', method: 'GET', headers: { host: 'localhost:5173', ...headers } } as never;
      let status = 200;
      const res = {
        set statusCode(s: number) {
          status = s;
        },
        setHeader() {},
        end(body: string) {
          resolve({ status, body });
        },
      } as never;
      void api(req, res, () => resolve({ status: 0, body: '' }));
    });
  assert.equal((await run({ origin: 'https://evil.example' })).status, 403);
  const proxied = createApi(readServerEnv({ TCC_PUBLIC_HOSTS: 'vanmohchitfunds.buziness365.com' }, tmp()));
  const viaProxy = (origin: string) =>
    new Promise<number>((resolve) => {
      let status = 200;
      const req = { url: '/api/health', method: 'GET', headers: { host: 'tcc-vanmoh-production.up.railway.app', origin } } as never;
      const res = { set statusCode(s: number) { status = s; }, setHeader() {}, end() { resolve(status); } } as never;
      void proxied(req, res, () => resolve(0));
    });
  assert.equal(await viaProxy('https://vanmohchitfunds.buziness365.com'), 200, 'the forwarded public address is the same site');
  assert.equal(await viaProxy('https://evil.example'), 403);
  const ok = await run({ origin: 'http://localhost:5173' });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true, analysis: true, recordings: false, telecmiAppId: false, database: false });
});
