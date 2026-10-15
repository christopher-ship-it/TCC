// Fetch a TeleCMI call recording on the server, where the App Secret can live. Ported from BusinessOS
// (lib/calls/analyze.ts). Recordings are cached on disk under .data/recordings so playback, seeking and
// re-analysis never hit the carrier twice.

import fs from 'node:fs';
import path from 'node:path';
import type { ServerEnv } from './env.ts';

/** A carrier recording reference: a bare file name, never a URL or a path. */
export const RECORDING_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Recognise audio by its first bytes — carriers label error pages and audio alike, so headers prove nothing. */
export function sniffAudio(buf: Uint8Array): string | null {
  const b = buf.subarray(0, 12);
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

/**
 * Where a recording can be downloaded from, best first. TeleCMI's REST play endpoints authenticate with the
 * App Secret. The dashboard link is kept last: it is how TCC's player used to stream, but TeleCMI now
 * redirects anonymous requests for it to a login page.
 */
export function recordingSources(file: string, env: ServerEnv): string[] {
  if (!RECORDING_FILE_RE.test(file)) throw new Error('Invalid recording reference.');
  const out: string[] = [];
  if (env.telecmiAppId && env.telecmiSecret) {
    const q = (key: string) => `appid=${encodeURIComponent(env.telecmiAppId!)}&${key}=${encodeURIComponent(env.telecmiSecret!)}&file=${encodeURIComponent(file)}`;
    out.push(`https://rest.telecmi.com/v2/play?${q('secret')}`);
    out.push(`https://rest.telecmi.com/v2/piopiy/play?${q('secret')}`);
    out.push(`https://piopiy.telecmi.com/v1/play?${q('token')}`);
  }
  if (env.telecmiAppId) {
    out.push(`https://${env.telecmiDashboardHost}/connly_voice/download_music/${encodeURIComponent(file)}?inet_no=${encodeURIComponent(env.telecmiAppId)}`);
  }
  return out;
}

export interface Recording {
  data: Uint8Array;
  contentType: string;
}

function cachePath(env: ServerEnv, file: string) {
  return path.join(env.dataDir, 'recordings', file);
}

/** The recording's bytes. Throws a message saying what the carrier answered — never the URL, which may carry the secret. */
export async function fetchRecording(file: string, env: ServerEnv, fetchImpl: typeof fetch = fetch): Promise<Recording> {
  const sources = recordingSources(file, env);
  const cached = cachePath(env, file);
  try {
    const data = new Uint8Array(fs.readFileSync(cached));
    const kind = sniffAudio(data);
    if (kind) return { data, contentType: kind };
  } catch {
    // not cached yet
  }
  if (!sources.length) throw new Error('Call recordings are not available right now.');

  const answers: string[] = [];
  for (const url of sources) {
    try {
      const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(45_000) });
      if (res.status >= 300 && res.status < 400) {
        answers.push(`HTTP ${res.status} → redirect`);
        continue;
      }
      const data = new Uint8Array(await res.arrayBuffer());
      const kind = sniffAudio(data);
      if (res.ok && kind && data.byteLength > 1000) {
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, data);
        return { data, contentType: kind };
      }
      const text = new TextDecoder().decode(data.subarray(0, 160)).replace(/\s+/g, ' ').trim();
      answers.push(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
    } catch (e) {
      answers.push(e instanceof Error ? e.message : 'request failed');
    }
  }
  console.error(`[tcc api] recording ${file} not retrieved${env.telecmiSecret ? '' : ' (App Secret not set)'}: ${answers.join(' | ')}`);
  throw new Error('The recording is not available yet.');
}
