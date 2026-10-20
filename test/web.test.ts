// Local viewer server: connected-mode page, SSE, host/origin/token checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSimulation } from '../src/engine/index.ts';
import { createWebApp, type WebApp } from '../src/server/web.ts';

let app: WebApp;
let port = 0;
const sim = createSimulation({ seed: 11 });

function req(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers: { host: '127.0.0.1:' + port, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; if (path.startsWith('/api/stream') && text.includes('event: init')) { res.destroy(); resolve({ status: res.statusCode!, text, headers: res.headers }); } });
      res.on('end', () => resolve({ status: res.statusCode!, text, headers: res.headers }));
      res.on('error', () => resolve({ status: res.statusCode!, text, headers: res.headers }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

before(async () => {
  app = createWebApp({ sim, html: '<!doctype html><html lang="zh-Hant"><body>page</body></html>', controls: { running: true, speed: 1 } });
  port = await app.listen(0);
});
after(async () => { await app.close(); });

test('serves the page in connected mode with a token and a strict CSP', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /data-mode="connected" data-token="[0-9a-f]{32}"/);
  assert.match(String(r.headers['content-security-policy']), /connect-src 'self'/);
});

test('rejects foreign Host headers (DNS rebinding)', async () => {
  const r = await req('GET', '/api/state', { host: 'evil.example:' + port });
  assert.equal(r.status, 421);
});

test('state and stream need the page token (a plain GET cannot read the scenario events)', async () => {
  for (const path of ['/api/state', '/api/stream', '/api/stream?token=wrong']) {
    const r = await req('GET', path);
    assert.equal(r.status, 403, path);
    assert.doesNotMatch(r.text, /IDV|inject|events/i, path);
  }
  assert.equal((await req('GET', '/api/state', { 'x-pcl-token': app.token, origin: 'http://evil.example' })).status, 403, 'foreign origin');
});

test('state and SSE init are served with the token (header or query)', async () => {
  const s = await req('GET', '/api/state', { 'x-pcl-token': app.token });
  const j = JSON.parse(s.text);
  assert.equal(j.mode, 'connected');
  assert.equal(j.history.t.length, 480);
  assert.ok(j.safety.rules);
  assert.equal((await req('GET', '/api/state?token=' + app.token)).status, 200);
  const e = await req('GET', '/api/stream?token=' + app.token);
  assert.equal(e.status, 200);
  assert.match(e.text, /event: init/);
});

test('POST requires token, same origin and JSON', async () => {
  const body = JSON.stringify({ action: 'inject', magnitude: 5 });
  assert.equal((await req('POST', '/api/control', { 'content-type': 'application/json' }, body)).status, 403);
  assert.equal((await req('POST', '/api/control', { 'content-type': 'application/json', 'x-pcl-token': app.token, origin: 'http://evil.example' }, body)).status, 403);
  assert.equal((await req('POST', '/api/control', { 'content-type': 'text/plain', 'x-pcl-token': app.token }, body)).status, 415);
  const ok = await req('POST', '/api/control', { 'content-type': 'application/json', 'x-pcl-token': app.token, origin: 'http://127.0.0.1:' + port }, body);
  assert.equal(ok.status, 200);
  assert.equal(sim.plant.M.d, 5);
  const bad = await req('POST', '/api/control', { 'content-type': 'application/json', 'x-pcl-token': app.token }, JSON.stringify({ action: 'inject', magnitude: 50 }));
  assert.equal(bad.status, 400);
  const big = await req('POST', '/api/control', { 'content-type': 'application/json', 'x-pcl-token': app.token }, JSON.stringify({ action: 'x', pad: 'y'.repeat(20000) }));
  assert.equal(big.status, 413);
});

test('page proposals go through the gate', async () => {
  const u = sim.plant.VAL['XMV(10)'];
  const r = await req('POST', '/api/propose', { 'content-type': 'application/json', 'x-pcl-token': app.token }, JSON.stringify({ xmv: 'XMV(10)', target: u + 30, rationale: 'page', apply: true }));
  const j = JSON.parse(r.text);
  assert.equal(j.verdict, 'REJECT');
  assert.equal(j.applied, false);
  assert.equal((sim.gateLog.at(-1) as { source: string }).source, 'page');
});

test('connected mode fails closed when the page has no plain <html lang> tag', () => {
  const s2 = createSimulation({ seed: 12 });
  for (const html of ['<!doctype html><html lang="zh-Hant" class="x"><body>page</body></html>', '<!doctype html><body>no html tag</body>', '<!doctype html><html><body>no lang</body></html>']) {
    assert.throws(() => createWebApp({ sim: s2, html, controls: { running: false, speed: 1 } }), /cannot enable connected mode/, html);
  }
});

test('the real built index.html gets the connected-mode marker and keeps its zh-Hant default', async () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const app2 = createWebApp({ sim: createSimulation({ seed: 13 }), html, controls: { running: false, speed: 1 } });
  const p2 = await app2.listen(0);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port: p2, method: 'GET', path: '/', headers: { host: '127.0.0.1:' + p2 } }, (res) => {
        let t = '';
        res.on('data', (c) => { t += c; });
        res.on('end', () => resolve(t));
      });
      r.on('error', reject);
      r.end();
    });
    assert.match(text, /<html lang="zh-Hant" data-mode="connected" data-token="[0-9a-f]{32}">/);
    assert.equal(text.match(/data-token="/g)?.length, 1);
  } finally {
    await app2.close();
  }
});
