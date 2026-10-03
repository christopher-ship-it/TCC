// TCC's small server API, mounted into Vite's dev and preview servers (vite.config.ts). Plain Node handlers, so
// the same functions can move into a hosted function when TCC gets a backend.
//
//   GET  /api/health              → which server features are configured
//   GET  /api/recordings/:file    → the call recording (Range requests supported, so the player can seek)
//   POST /api/analyze             → { file, customer?, business?, app?, levels? } → CallAnalysis

import type { IncomingMessage, ServerResponse } from 'node:http';
import { analyzeRecording, NotConfigured, type AnalyzeRequest } from './analyze.ts';
import type { ServerEnv } from './env.ts';
import { fetchRecording, RECORDING_FILE_RE } from './recordings.ts';

type Next = (err?: unknown) => void;

const MAX_BODY = 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  const raw = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(raw);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** Another site in the same browser must not be able to spend this machine's Gemini or TeleCMI quota. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function isLevels(v: unknown): v is [number, number, number][] {
  return Array.isArray(v) && v.length <= 7200 && v.every((s) => Array.isArray(s) && s.length === 3 && s.every((n) => typeof n === 'number' && Number.isFinite(n)));
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export function createApi(env: ServerEnv) {
  return async function api(req: IncomingMessage, res: ServerResponse, next: Next) {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return next();
    if (!sameOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, {
          ok: true,
          analysis: Boolean(env.geminiKey),
          recordings: Boolean(env.telecmiAppId && env.telecmiSecret),
          telecmiAppId: Boolean(env.telecmiAppId),
        });
      }

      const rec = url.pathname.match(/^\/api\/recordings\/([^/]+)$/);
      if (req.method === 'GET' && rec) {
        const file = decodeURIComponent(rec[1]);
        if (!RECORDING_FILE_RE.test(file)) return send(res, 400, { error: 'Invalid recording reference.' });
        const { data, contentType } = await fetchRecording(file, env);
        const total = data.byteLength;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
        if (range) {
          const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
          if (start >= total || start > end) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${total}`);
            return res.end();
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', String(end - start + 1));
          return res.end(Buffer.from(data.subarray(start, end + 1)));
        }
        res.statusCode = 200;
        res.setHeader('Content-Length', String(total));
        return res.end(Buffer.from(data));
      }

      if (req.method === 'POST' && url.pathname === '/api/analyze') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const file = text(body.file);
        if (!file || !RECORDING_FILE_RE.test(file)) return send(res, 400, { error: 'file must be a recording file name.' });
        const request: AnalyzeRequest = {
          file,
          customer: text(body.customer),
          business: text(body.business),
          app: text(body.app, 40),
          levels: isLevels(body.levels) ? body.levels : undefined,
        };
        return send(res, 200, { analysis: await analyzeRecording(request, env) });
      }

      return send(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e instanceof NotConfigured) return send(res, 501, { error: e.message, notConfigured: true });
      const message = e instanceof Error ? e.message : 'Request failed.';
      console.error(`[tcc api] ${req.method} ${url.pathname}: ${message}`);
      return send(res, 502, { error: message });
    }
  };
}
