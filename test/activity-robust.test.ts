// LLM activity feed robustness: the observer never changes results or breaks the
// MCP path, errors are recorded, client state follows the connection, the
// simulation overlay expires and is invalidated when the plant changes.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSimulation, type Simulation } from '../src/engine/index.ts';
import { ActivityLog, SESSION_RELOG_MS, SIM_OVERLAY_TTL_MS, cleanText, summarizeArgs, type ActivityRecord } from '../src/server/activity.ts';
import { loadDocs } from '../src/server/docs.ts';
import { createMcpServer } from '../src/server/mcp.ts';
import { createWebApp } from '../src/server/web.ts';

const ch = (n: number) => String.fromCodePoint(n);
const mk = () => createSimulation({ seed: 7, now: () => 0 });

async function connect(sim: Simulation, activity?: ActivityLog, info = { name: 'robust-client', version: '1.0' }) {
  const server = createMcpServer(activity ? { sim, activity } : { sim }, loadDocs());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client(info);
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server, close: async () => { await client.close(); await server.close(); } };
}

/** the same call sequence, returning every raw tool result */
async function script(client: Client, sim: Simulation): Promise<unknown[]> {
  const u = sim.plant.VAL['XMV(10)'];
  const calls: [string, Record<string, unknown>][] = [
    ['get_plant_overview', {}],
    ['get_signals', { ids: ['XMEAS(9)', 'XMV(10)'], window_minutes: 12 }],
    ['get_safety_state', {}],
    ['get_topology_impact', { node_id: 'reactor', max_hops: 2 }],
    ['get_engineering_context', { node_id: 'reactor' }],
    ['simulate_adjustment', { xmv: 'XMV(10)', target: +(u + 2).toFixed(1), minutes: 12 }],
    ['propose_adjustment', { xmv: 'XMV(10)', target: +(u + 30).toFixed(1), rationale: 'too big' }],
    ['propose_adjustment', { xmv: 'XMV(10)', target: +(u + 1).toFixed(1), rationale: 'small' }],
    ['get_gate_log', { limit: 5 }],
    ['get_signals', { ids: Array(9).fill('XMEAS(1)') }],
  ];
  const out: unknown[] = [];
  for (const [name, args] of calls) out.push(await client.callTool({ name, arguments: args }));
  out.push(await client.readResource({ uri: 'rules://limits' }));
  out.push(await client.getPrompt({ name: 'operator-assistant' }));
  return out;
}

test('tool results are identical with and without the observer', async () => {
  const simA = mk();
  const simB = mk();
  const activity = new ActivityLog({ snapshot: () => simA.snapshot().id });
  const a = await connect(simA, activity);
  const b = await connect(simB);
  const ra = await script(a.client, simA);
  const rb = await script(b.client, simB);
  assert.deepEqual(ra, rb);
  assert.ok(activity.records.filter((r) => r.kind === 'tool').length === 10);
  await a.close();
  await b.close();
});

test('an observer or a viewer listener that throws does not affect the responses', async () => {
  class Broken extends ActivityLog {
    override recordResponse(): void { throw new Error('observer boom'); }
  }
  const simA = mk();
  const simB = mk();
  const broken = new Broken();
  broken.subscribe(() => { throw new Error('listener boom'); });
  const a = await connect(simA, broken);
  const b = await connect(simB);
  assert.deepEqual(await script(a.client, simA), await script(b.client, simB));
  await a.close();
  await b.close();
});

test('unknown tools and JSON-RPC error responses are recorded as errors', async () => {
  const sim = mk();
  const activity = new ActivityLog();
  const c = await connect(sim, activity);
  await c.client.callTool({ name: 'no_such_tool', arguments: {} }).catch(() => null);
  await assert.rejects(c.client.getPrompt({ name: 'no-such-prompt' }));
  await assert.rejects(c.client.readResource({ uri: 'docs://no-such-doc' }));
  const by = (n: string) => activity.records.find((r) => r.name === n) as ActivityRecord;
  assert.equal(by('no_such_tool').kind, 'tool');
  assert.equal(by('no_such_tool').outcome, 'error');
  assert.match(by('no_such_tool').summary, /not found/i);
  assert.equal(by('no-such-prompt').kind, 'prompt');
  assert.equal(by('no-such-prompt').outcome, 'error');
  assert.match(by('no-such-prompt').summary, /not found/i);
  assert.equal(by('docs://no-such-doc').kind, 'resource');
  assert.equal(by('docs://no-such-doc').outcome, 'error');
  await c.close();
});

test('a response that cannot be delivered is recorded as an error', async () => {
  const activity = new ActivityLog();
  const fake = {
    onmessage: undefined as ((m: unknown, e?: unknown) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    start: async () => {},
    close: async () => {},
    send: async (_message: unknown): Promise<void> => { throw new Error('pipe closed'); },
  };
  activity.observe(fake as never);
  fake.onmessage!({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_safety_state', arguments: {} } });
  await assert.rejects(fake.send({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"ok":false,"error":"x"}' }] } } as never), /pipe closed/);
  await new Promise((r) => setImmediate(r));
  const last = activity.records.at(-1)!;
  assert.equal(last.outcome, 'error');
  assert.match(last.summary, /^response not delivered: pipe closed$/);
});

test('observing the same transport twice records each call once', async () => {
  const sim = mk();
  const activity = new ActivityLog();
  const server = createMcpServer({ sim, activity }, loadDocs());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  activity.observe(st, { trackClose: true }); // the server observes it again on connect
  const client = new Client({ name: 'twice', version: '1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  await client.callTool({ name: 'get_safety_state', arguments: {} });
  assert.equal(activity.records.filter((r) => r.name === 'get_safety_state').length, 1);
  assert.equal(activity.records.filter((r) => r.name === 'initialize').length, 1);
  await client.close();
  await server.close();
});

test('client state follows the connection; repeated handshakes are not logged again', async () => {
  let clock = 1_000_000;
  const sim = mk();
  const activity = new ActivityLog({ now: () => clock });
  const a = await connect(sim, activity, { name: 'same-client', version: '2.0' });
  assert.equal(activity.client?.connected, true);
  const sessions = () => activity.records.filter((r) => r.kind === 'session' && r.name === 'initialize').length;
  await a.client.callTool({ name: 'get_safety_state', arguments: {} });
  // a flood of re-initializations (as a stateless HTTP client might send) cannot evict tool records
  const protocolVersion = activity.client!.protocol;
  for (let i = 0; i < 300; i++) { activity.clientInitializing({ clientInfo: { name: 'same-client', version: '2.0' }, protocolVersion }); activity.clientInitialized(); }
  assert.equal(sessions(), 1);
  assert.ok(activity.records.some((r) => r.name === 'get_safety_state'));
  // the same client initializing again over another connection: no second session record
  const b = await connect(sim, activity, { name: 'same-client', version: '2.0' });
  assert.equal(sessions(), 1);
  await b.close(); // the connection that owns the client closes
  assert.equal(activity.client?.connected, false);
  assert.match(activity.records.at(-1)!.summary, /same-client 2\.0 disconnected/);
  await a.close();
  // reconnecting after a disconnect, or after the relog window, is logged again
  const c = await connect(sim, activity, { name: 'same-client', version: '2.0' });
  assert.equal(sessions(), 2);
  assert.equal(activity.client?.connected, true);
  await c.close();
  clock += SESSION_RELOG_MS + 1;
  const d = await connect(sim, activity, { name: 'other-client', version: '1' });
  assert.equal(sessions(), 3);
  await d.close();
});

test('the simulation overlay expires after its TTL (injectable clock)', async () => {
  let clock = 5_000;
  const sim = mk();
  const activity = new ActivityLog({ now: () => clock });
  const c = await connect(sim, activity);
  await c.client.callTool({ name: 'simulate_adjustment', arguments: { xmv: 'XMV(10)', target: 45 } });
  assert.ok(activity.state().sim);
  assert.equal(activity.state().sim!.ageMs, 0);
  clock += SIM_OVERLAY_TTL_MS;
  assert.ok(activity.state().sim, 'still shown at exactly the TTL');
  clock += 1;
  assert.equal(activity.state().sim, null);
  await c.close();
});

test('an applied proposal over MCP invalidates the simulation overlay', async () => {
  const sim = mk();
  const activity = new ActivityLog();
  const updates: unknown[] = [];
  activity.subscribe((u) => updates.push(u));
  const c = await connect(sim, activity);
  const u = sim.plant.VAL['XMV(10)'];
  await c.client.callTool({ name: 'simulate_adjustment', arguments: { xmv: 'XMV(10)', target: +(u + 1).toFixed(1) } });
  await c.client.callTool({ name: 'propose_adjustment', arguments: { xmv: 'XMV(10)', target: +(u + 30).toFixed(1), rationale: 'rejected' } });
  assert.ok(activity.state().sim, 'a REJECT changes nothing');
  await c.client.callTool({ name: 'propose_adjustment', arguments: { xmv: 'XMV(10)', target: +(u + 1).toFixed(1), rationale: 'accepted' } });
  assert.equal(activity.state().sim, null);
  assert.ok(updates.some((x) => (x as { simCleared?: boolean }).simCleared === true));
  await c.close();
});

test('a human control on the viewer invalidates the simulation overlay', async () => {
  const sim = createSimulation({ seed: 31 });
  const activity = new ActivityLog();
  const app = createWebApp({ sim, html: '<!doctype html><html lang="zh-Hant"><body>page</body></html>', controls: { running: true, speed: 1 }, activity });
  const port = await app.listen(0);
  const c = await connect(sim, activity);
  try {
    await c.client.callTool({ name: 'simulate_adjustment', arguments: { xmv: 'XMV(10)', target: 45 } });
    assert.ok(activity.state().sim);
    const status = await new Promise<number>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/control', headers: { host: '127.0.0.1:' + port, 'content-type': 'application/json', 'x-pcl-token': app.token } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      r.on('error', reject);
      r.end(JSON.stringify({ action: 'inject', magnitude: 5 }));
    });
    assert.equal(status, 200);
    assert.equal(activity.state().sim, null);
  } finally {
    await c.close();
    await app.close();
  }
});

test('more invisible characters are stripped; argument summaries are bounded in keys and depth', () => {
  const invisible = [0xad, 0x61c, 0x180e, 0xfff9, 0xfffa, 0xfffb, 0xe0001, 0xe0041, 0xe007f, 0x2066, 0x200d].map(ch).join('');
  assert.equal(cleanText('a' + invisible + 'b', 50), 'a b');
  assert.equal(cleanText('safe' + ch(0xe0041) + ch(0xe0042), 50), 'safe');
  const wide: Record<string, number> = {};
  for (let i = 0; i < 50; i++) wide['k' + i] = i;
  assert.equal(summarizeArgs(wide).split(' ').length, 8);
  assert.equal(summarizeArgs({ a: [[[[1]]]] }), 'a=[[[…]]]');
  assert.equal(summarizeArgs({ o: { deep: { x: 1 } } }), 'o={…}');
});
