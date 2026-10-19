/**
 * Local web server (127.0.0.1 only) serving the same page in connected mode.
 *
 *   GET  /               page, marked data-mode="connected" with a per-process token
 *   GET  /api/state      current state + chart history
 *   GET  /api/stream     Server-Sent Events: init, then tick batches
 *   POST /api/control    human scenario controls: inject / remove / auto / run / speed
 *   POST /api/propose    gate evaluation from the page (dry-run or apply)
 *   *    /mcp            optional Streamable HTTP MCP endpoint (--http-mcp)
 *
 * Hardening: Host header must be this loopback origin (blocks DNS rebinding);
 * POSTs need JSON, a same-origin Origin when present, and the page token (blocks
 * cross-site requests); bodies are capped; SSE clients are capped.
 *
 * Trust boundary: the loopback interface. Browsers on other sites cannot drive or
 * read this server, but any local process can load the page (and its token). Do
 * not give the agent a shell or HTTP-fetch tool pointed at the viewer port; its
 * only intended path is the MCP tools, which cannot inject or reset anything.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { evaluateAdjustment, type GateLogEntry, type Sample, type SimEvent, type Simulation } from '../engine/index.ts';

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_SSE_CLIENTS = 8;
export const MAX_SSE_BUFFERED_BYTES = 256 * 1024;
const LOG_TAIL = 30;

export interface Controls { running: boolean; speed: number }

export interface WebAppOptions {
  sim: Simulation;
  html: string;
  controls: Controls;
  /** optional Streamable HTTP MCP handler */
  mcpHttp?: (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;
  log?: (msg: string) => void;
}

export interface WebApp {
  server: Server;
  token: string;
  listen(port: number, host?: string, attempts?: number): Promise<number>;
  broadcast(samples: Sample[]): void;
  close(): Promise<void>;
}

const r4 = (v: number) => +(+v).toFixed(4);
const errStatus = (e: unknown) => ((e as { status?: number }).status === 413 ? 413 : 400);

function compactSample(s: Sample) {
  const v: Record<string, number> = {};
  for (const k of Object.keys(s.values)) v[k] = r4(s.values[k]);
  return { t: r4(s.t), K: s.K, v, d: s.disturbance, m: s.mode };
}

export function createWebApp(opt: WebAppOptions): WebApp {
  const { sim, controls } = opt;
  const log = opt.log || (() => {});
  const token = randomBytes(16).toString('hex');
  // the page picks its display language itself (?lang= / remembered choice); only the mode marker is added here
  const page = opt.html.replace(/<html lang="([a-zA-Z-]+)">/, (_m, lang: string) => '<html lang="' + lang + '" data-mode="connected" data-token="' + token + '">');
  if (page === opt.html) throw new Error('index.html has no <html lang="..."> tag: cannot enable connected mode');
  const clients = new Set<ServerResponse>();
  let port = 0;
  let lastGate = -1;
  let lastEvent = -1;

  const allowedHosts = () => ['127.0.0.1:' + port, 'localhost:' + port];
  const allowedOrigins = () => ['http://127.0.0.1:' + port, 'http://localhost:' + port];

  function send(res: ServerResponse, code: number, body: unknown, type = 'application/json; charset=utf-8') {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    res.end(data);
  }

  function history() {
    const h = sim.hist;
    return { t: h.t.map(r4), K: h.K.slice(), x9: h.v['XMEAS(9)'].map(r4), x21: h.v['XMEAS(21)'].map(r4), u10: h.v['XMV(10)'].map(r4), x7: h.v['XMEAS(7)'].map(r4) };
  }

  function statePayload(full: boolean) {
    return {
      mode: 'connected',
      sample: compactSample(sim.sample()),
      safety: sim.safety(),
      running: controls.running,
      speed: controls.speed,
      gateSeq: sim.gateSeq,
      eventSeq: sim.eventSeq,
      gateLog: (sim.gateLog as GateLogEntry[]).slice(-LOG_TAIL),
      events: (sim.events as SimEvent[]).slice(-LOG_TAIL),
      ...(full ? { history: history() } : {}),
    };
  }

  function writeEvent(res: ServerResponse, name: string, data: unknown) {
    if (res.writableEnded || res.destroyed) { clients.delete(res); return; }
    // Backpressure cap: a viewer that stops reading is dropped instead of buffering without bound.
    if (res.writableLength > MAX_SSE_BUFFERED_BYTES) { clients.delete(res); res.destroy(); return; }
    res.write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n');
  }

  function broadcast(samples: Sample[]) {
    if (!clients.size) { lastGate = sim.gateSeq; lastEvent = sim.eventSeq; return; }
    const gateChanged = sim.gateSeq !== lastGate;
    const eventChanged = sim.eventSeq !== lastEvent;
    lastGate = sim.gateSeq;
    lastEvent = sim.eventSeq;
    const payload = {
      samples: samples.map(compactSample),
      safety: sim.safety(),
      running: controls.running,
      speed: controls.speed,
      gateSeq: sim.gateSeq,
      eventSeq: sim.eventSeq,
      ...(gateChanged ? { gateLog: (sim.gateLog as GateLogEntry[]).slice(-LOG_TAIL) } : {}),
      ...(eventChanged ? { events: (sim.events as SimEvent[]).slice(-LOG_TAIL) } : {}),
    };
    for (const c of clients) writeEvent(c, 'tick', payload);
  }

  function hostOk(req: IncomingMessage): boolean {
    return allowedHosts().includes(String(req.headers.host || '').toLowerCase());
  }

  function originOk(req: IncomingMessage): boolean {
    const o = req.headers.origin;
    return o === undefined || allowedOrigins().includes(String(o).toLowerCase());
  }

  function tokenOk(req: IncomingMessage): boolean {
    const got = Buffer.from(String(req.headers['x-pcl-token'] || ''));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  function readJson(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let size = 0;
      let tooLarge = false;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) { tooLarge = true; chunks.length = 0; return; } // keep draining, store nothing
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooLarge) { reject(Object.assign(new Error('body too large'), { status: 413 })); return; }
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function control(body: Record<string, unknown>): { ok: boolean; error?: string } {
    switch (body.action) {
      case 'inject': {
        const mag = Number(body.magnitude);
        if (mag !== 5 && mag !== 10) return { ok: false, error: 'magnitude must be 5 or 10' };
        sim.injectIdv4(mag, 'page');
        return { ok: true };
      }
      case 'remove': sim.removeDisturbance('page'); return { ok: true };
      case 'auto': sim.restoreAuto('page'); return { ok: true };
      case 'run': controls.running = !!body.on; return { ok: true };
      case 'speed': {
        const s = Number(body.value);
        if (s !== 1 && s !== 4) return { ok: false, error: 'speed must be 1 or 4' };
        controls.speed = s;
        return { ok: true };
      }
      default: return { ok: false, error: 'unknown action' };
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!hostOk(req)) { send(res, 421, { error: 'host not allowed' }); return; }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method || 'GET';

    if (path === '/mcp') {
      if (!opt.mcpHttp) { send(res, 404, { error: 'not found' }); return; }
      if (!originOk(req)) { send(res, 403, { error: 'origin not allowed' }); return; }
      let body: unknown = undefined;
      if (method === 'POST') {
        try { body = await readJson(req); } catch (e) { send(res, errStatus(e), { error: (e as Error).message }); return; }
      }
      await opt.mcpHttp(req, res, body);
      return;
    }

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      res.end(page);
      return;
    }
    if (method === 'GET' && path === '/api/state') { send(res, 200, statePayload(true)); return; }
    if (method === 'GET' && path === '/api/stream') {
      if (clients.size >= MAX_SSE_CLIENTS) { send(res, 503, { error: 'too many viewers' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write('retry: 3000\n\n');
      writeEvent(res, 'init', statePayload(true));
      clients.add(res);
      const hb = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': hb\n\n'); }, 15000);
      hb.unref();
      const drop = () => { clearInterval(hb); clients.delete(res); };
      req.on('close', drop);
      res.on('close', drop);
      res.on('error', drop);
      return;
    }
    if (method === 'POST' && (path === '/api/control' || path === '/api/propose')) {
      if (!originOk(req) || !tokenOk(req)) { send(res, 403, { error: 'forbidden' }); return; }
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { send(res, 415, { error: 'application/json required' }); return; }
      let body: Record<string, unknown>;
      try { body = (await readJson(req)) as Record<string, unknown>; } catch (e) { send(res, errStatus(e), { error: (e as Error).message }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'object body required' }); return; }
      if (path === '/api/control') {
        const r = control(body);
        send(res, r.ok ? 200 : 400, r);
        if (r.ok) broadcast([]);
        return;
      }
      const r = evaluateAdjustment(sim, { xmv: String(body.xmv ?? ''), target: typeof body.target === 'number' ? body.target : NaN, rationale: String(body.rationale ?? '') }, { apply: body.apply === true, source: 'page' });
      send(res, 200, r);
      broadcast([]);
      return;
    }
    send(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log('web error: ' + (e as Error).message);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  return {
    server,
    token,
    broadcast,
    listen(p: number, host = '127.0.0.1', attempts = 10): Promise<number> {
      return new Promise((resolve, reject) => {
        let tries = 0;
        const tryPort = (pp: number) => {
          const onErr = (e: NodeJS.ErrnoException) => {
            server.off('listening', onOk);
            if (e.code === 'EADDRINUSE' && ++tries < attempts && pp < 65535) tryPort(pp + 1);
            else reject(e);
          };
          const onOk = () => {
            server.off('error', onErr);
            server.on('error', (e) => log('web server error: ' + e.message)); // never an uncaught exception after bind
            const a = server.address();
            port = typeof a === 'object' && a ? a.port : pp;
            resolve(port);
          };
          server.once('error', onErr);
          server.once('listening', onOk);
          try { server.listen(pp, host); } catch (e) { server.off('error', onErr); server.off('listening', onOk); reject(e); }
        };
        tryPort(p);
      });
    },
    close(): Promise<void> {
      for (const c of clients) c.end();
      clients.clear();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
