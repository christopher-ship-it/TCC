// TCC's small server API, mounted into Vite's dev and preview servers (vite.config.ts). Plain Node handlers, so
// the same functions can move into a hosted function when TCC gets a backend.
//
//   GET  /api/health              → which server features are configured
//   GET  /api/db/health           → Neon connectivity, schema version and row counts (never the connection string)
//   GET  /api/recordings/:file    → the call recording (Range requests supported, so the player can seek)
//   POST /api/telephony/webhook   → TeleCMI's call-detail webhook (?secret=TCC_WEBHOOK_SECRET); stores recording file names
//   GET  /api/recording-lookup    → ?remote&startedAt&direction → { file } from those stored names (signed-in agents)
//   POST /api/analyze             → { file, customer?, business?, app?, levels? } → CallAnalysis
//   POST /api/telephony/status    → { id, password, status: online|offline } → the agent's TeleCMI availability
//   GET  /api/presence            → who is signed in right now (admins, supervisors)
//   POST /api/people/:id/signout  → ends someone's sessions (admins, for their own people)
//   GET  /api/audit/page?before=  → the next 100 older change-log entries (archive included)
//   GET  /api/logs/export?kind=activity|events&days=N → the log as a CSV file (archive included)
//   POST /api/feedback            → an agent's verdict on the AI's reading of a call (the AI then learns from it)
//   POST /api/assignments/run     → hands out customers now (signed-in agents); who holds how many
//   POST /api/sources/lookup      → { phone } → { customer } an incoming caller found in a product's own database
//   POST /api/system/sources/sync → { app, full? } run a product's customer sync now (super admin; server/appSync.ts)
//   /api/auth/*, /api/data, /api/people → sign-in and the shared records (server/store.ts), when a database is set

import type { IncomingMessage, ServerResponse } from 'node:http';
import { analyzeRecording, NotConfigured, type AnalyzeRequest } from './analyze.ts';
import type { ServerEnv } from './env.ts';
import { createDb } from './db.ts';
import { fetchRecording, RECORDING_FILE_RE } from './recordings.ts';
import { parseCdrWebhook, saveRecordedCall, webhookAuthorised } from './webhook.ts';
import { PresenceError, setAgentStatus } from './presence.ts';
import { createStore, HttpError, requestAgent } from './store.ts';
import { createSourceSync, SourceError } from './appSync.ts';
import { createAssigner } from './assign.ts';
import { createLimiter, requesterOf } from './rateLimit.ts';
import { startRetention } from './retention.ts';
import { createLearning } from './aiLearning.ts';
import { analysisQueue, onAnalysisEvent } from './analyze.ts';
import { endpointStats, logEvent, recentEvents, recentRequests, recordRequest, startedAt, connectEventStore } from './events.ts';

type Next = (err?: unknown) => void;

const MAX_BODY = 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  const raw = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(raw);
}

function readJson(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
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

/** Another site in the same browser must not be able to spend this machine's Gemini or TeleCMI quota. A proxy
 *  that forwards a public address here rewrites Host, so that address is accepted only when configured. */
function sameOrigin(req: IncomingMessage, publicHosts: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host.toLowerCase();
    return host === req.headers.host?.toLowerCase() || publicHosts.includes(host);
  } catch {
    return false;
  }
}

function isLevels(v: unknown): v is [number, number, number][] {
  return Array.isArray(v) && v.length <= 7200 && v.every((s) => Array.isArray(s) && s.length === 3 && s.every((n) => typeof n === 'number' && Number.isFinite(n)));
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** A live test of one dependency, timed. */
async function timed(fn: () => Promise<string>): Promise<{ ok: boolean; message: string; ms: number }> {
  const t = Date.now();
  try {
    return { ok: true, message: await fn(), ms: Date.now() - t };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), ms: Date.now() - t };
  }
}

export function createApi(env: ServerEnv) {
  const db = createDb(env.databaseUrl);
  if (db.configured) connectEventStore(() => db.ready());
  onAnalysisEvent((level, message) => logEvent({ level, source: 'analysis', message }));

  const check = (what: string) =>
    timed(async () => {
      if (what === 'database') {
        const h = await db.health();
        if (!h.ok) throw new Error(h.error ?? 'Database unreachable.');
        return `Connected · schema v${h.schemaVersion} · ${h.latencyMs} ms`;
      }
      if (what === 'gemini') {
        if (!env.geminiKey) throw new Error('GEMINI_API_KEY is not set.');
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}`, { headers: { 'x-goog-api-key': env.geminiKey }, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`Gemini answered HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
        return `Key works · model ${env.geminiModel} available`;
      }
      if (what === 'telecmi') {
        if (!env.telecmiAppId || !env.telecmiSecret) throw new Error('TeleCMI App ID / secret are not set.');
        const now = Date.now();
        const r = await fetch('https://rest.telecmi.com/v2/answered', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: Number(env.telecmiAppId), secret: env.telecmiSecret, from: now - 86400_000, to: now, page: 1, limit: 1 }), signal: AbortSignal.timeout(15_000) });
        const body = (await r.json().catch(() => ({}))) as { code?: number; msg?: string; message?: string };
        if (!r.ok || (body.code !== undefined && body.code !== 200)) throw new Error(`TeleCMI refused: ${String(body.code ?? r.status)} ${String(body.msg ?? body.message ?? '')}`.trim());
        return 'App ID and secret accepted';
      }
      throw new Error(`Unknown check “${what}”.`);
    });

  const systemHealth = async () => {
    const mem = process.memoryUsage();
    return {
      startedAt,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      deployment: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
      memoryMb: Math.round(mem.rss / 1048576),
      database: await db.health(),
      gemini: { configured: Boolean(env.geminiKey), model: env.geminiModel, queue: analysisQueue() },
      telecmi: { configured: Boolean(env.telecmiAppId && env.telecmiSecret), appId: env.telecmiAppId ?? null },
      setupFormOpen: Boolean(env.setupCode),
      endpoints: endpointStats(),
      requests: recentRequests(),
      events: await recentEvents(db.configured ? await db.ready().catch(() => null) : null, 100),
    };
  };

  const sources = db.configured && env.sources.length ? createSourceSync(() => db.ready(), env.sources, { everyMinutes: env.sourceSyncMinutes }) : undefined;
  const learning = db.configured ? createLearning(() => db.ready()) : undefined;
  const limiter = createLimiter();
  const limitedRecently = new Map<string, number>();
  const assigner = db.configured ? createAssigner(() => db.ready(), { capacity: env.assignCapacity }) : undefined;
  const store = createStore(() => db.ready(), { setupCode: env.setupCode, systemHealth, check, sources, assigner, learning }, readJson, send);
  async function api(req: IncomingMessage, res: ServerResponse, next: Next) {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return next();
    const t0 = Date.now();
    res.on?.('finish', () => {
      // The super admin's own polling would drown everything else out.
      if (url.pathname === '/api/system') return;
      recordRequest({ ts: t0, method: req.method ?? 'GET', path: url.pathname, status: res.statusCode, ms: Date.now() - t0, agentName: requestAgent.get(req)?.name });
    });
    if (!sameOrigin(req, env.publicHosts)) return send(res, 403, { error: 'Cross-site request refused.' });

    // Brakes: every request counts against the first rule it matches (server/rateLimit.ts).
    const who = requesterOf(req);
    const verdict = limiter.check(req.method ?? 'GET', url.pathname, who);
    if (!verdict.ok) {
      const key = `${verdict.rule.id}|${who.person ?? who.address}`;
      if (Date.now() - (limitedRecently.get(key) ?? 0) > 10 * 60_000) {
        limitedRecently.set(key, Date.now());
        if (limitedRecently.size > 500) limitedRecently.clear();
        logEvent({ level: 'warn', source: 'ratelimit', message: `Slowed down “${verdict.rule.label}” (${verdict.rule.limit} per ${Math.round(verdict.rule.windowMs / 60_000)} min)`, detail: { rule: verdict.rule.id, path: url.pathname } });
      }
      res.setHeader?.('Retry-After', String(verdict.retryAfterSec));
      return send(res, 429, { error: `Too many requests. Try again in ${verdict.retryAfterSec} seconds.`, retryAfter: verdict.retryAfterSec });
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, {
          ok: true,
          analysis: Boolean(env.geminiKey),
          recordings: Boolean(env.telecmiAppId && env.telecmiSecret),
          telecmiAppId: Boolean(env.telecmiAppId),
          database: db.configured,
          customerSync: (sources ? env.sources.map((x) => x.app) : []),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/db/health') {
        const h = await db.health();
        return send(res, h.ok ? 200 : 503, h);
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
          customerTypes: Array.isArray(body.customerTypes) ? body.customerTypes.filter((t): t is string => typeof t === 'string').slice(0, 8).map((t) => t.slice(0, 40)) : undefined,
          levels: isLevels(body.levels) ? body.levels : undefined,
        };
        return send(res, 200, { analysis: await analyzeRecording({ ...request, lessons: (await learning?.lessonsFor(request.app).catch(() => '')) || undefined }, env) });
      }

      // TeleCMI's call-detail webhook: it announces each recording, so TCC no longer depends on an agent's browser to find it.
      if (req.method === 'POST' && url.pathname === '/api/telephony/webhook') {
        if (!webhookAuthorised(url.searchParams.get('secret') ?? (req.headers['x-webhook-secret'] as string | undefined), env.webhookSecret)) return send(res, 401, { error: 'Not allowed.' });
        if (!db.configured) return send(res, 501, { error: 'No database is connected (DATABASE_URL).', notConfigured: true });
        const body = await readJson(req, 64 * 1024);
        const rec = parseCdrWebhook(body);
        if (rec) {
          await saveRecordedCall(await db.ready(), rec);
          logEvent({ level: 'info', source: 'telephony', message: `TeleCMI announced a recording (${rec.direction ?? 'call'} …${rec.remote.slice(-4)}, ${rec.talkSeconds ?? '?'}s)` });
        } else {
          const t = (body as { type?: unknown; status?: unknown; record?: unknown } | null) ?? {};
          logEvent({ level: 'info', source: 'telephony', message: `TeleCMI webhook without a recording (type ${String(t.type)}, status ${String(t.status)}, record ${String(t.record)})` });
        }
        return send(res, 200, { ok: true });
      }

      if (/^\/api\/(auth\/|data$|recording-lookup$|people|notices|notes|password-requests$|events$|assignments\/|presence$|audit\/|logs\/|feedback$|system|sources\/lookup$)/.test(url.pathname)) {
        if (!db.configured) return send(res, 501, { error: 'No database is connected (DATABASE_URL).', notConfigured: true });
        if (await store(req, res, url)) return;
      }

      if (req.method === 'POST' && url.pathname === '/api/telephony/status') {
        const body = (await readJson(req)) as Record<string, unknown>;
        return send(res, 200, { status: await setAgentStatus(body, env) });
      }

      return send(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status !== 401) logEvent({ level: 'warn', source: 'api', message: `${req.method} ${url.pathname} → ${e.status}: ${e.message}`, agentId: requestAgent.get(req)?.id, agentName: requestAgent.get(req)?.name });
        return send(res, e.status, { error: e.message });
      }
      if (e instanceof PresenceError || e instanceof SourceError) return send(res, e.status, { error: e.message });
      if (e instanceof NotConfigured) return send(res, 501, { error: e.message, notConfigured: true });
      const message = e instanceof Error ? e.message : 'Request failed.';
      logEvent({ level: 'error', source: 'api', message: `${req.method} ${url.pathname}: ${message}`, agentId: requestAgent.get(req)?.id, agentName: requestAgent.get(req)?.name });
      return send(res, 502, { error: message });
    }
  }

  /** The customer sync runs only on a server that serves requests — never during `vite build`. */
  api.startBackgroundJobs = () => {
    sources?.start();
    assigner?.start();
    if (db.configured) startRetention(() => db.ready());
  };
  return api;
}
