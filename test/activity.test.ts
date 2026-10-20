// LLM activity feed: one record per MCP request, bounded, scenario-free, capped
// untrusted text, initialize detection, and live delivery over the viewer's SSE.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSimulation, type Simulation } from '../src/engine/index.ts';
import { ACTIVITY_CAP, ActivityLog, MAX_ARGS_LEN, MAX_CLIENT_FIELD_LEN, MAX_RATIONALE_LEN, cleanText, type ActivityRecord } from '../src/server/activity.ts';
import { loadDocs } from '../src/server/docs.ts';
import { createMcpServer } from '../src/server/mcp.ts';
import { createWebApp } from '../src/server/web.ts';

const SNAP = /^snap@T\d+\.\d{2}h\/K\d+$/;
const ch = (n: number) => String.fromCharCode(n);

async function connected(sim: Simulation, activity: ActivityLog, info = { name: 'test-client', version: '1.2.3' }) {
  const server = createMcpServer({ sim, activity }, loadDocs());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client(info);
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { client, server, call, close: async () => { await client.close(); await server.close(); } };
}

const mk = () => createSimulation({ seed: 7, now: () => 0 });
const toolRec = (a: ActivityLog, name: string): ActivityRecord => {
  const r = a.records.find((x) => x.kind === 'tool' && x.name === name);
  assert.ok(r, 'no record for ' + name);
  return r;
};

test('initialize: no client before, client name/version and a session record after', async () => {
  const sim = mk();
  const activity = new ActivityLog({ snapshot: () => sim.snapshot().id });
  assert.equal(activity.state().client, null);
  const c = await connected(sim, activity, { name: 'codex-mcp-client', version: '0.9.1' });
  const st = activity.state();
  assert.equal(st.client?.initialized, true);
  assert.equal(st.client?.name, 'codex-mcp-client');
  assert.equal(st.client?.version, '0.9.1');
  assert.ok(st.client?.protocol);
  const s = st.records.find((r) => r.kind === 'session' && r.name === 'initialize');
  assert.ok(s);
  assert.match(s.summary, /codex-mcp-client 0\.9\.1 connected/);
  await c.close();
});

test('every tool, resource read, prompt get and list call is recorded with a sensible summary', async () => {
  const sim = mk();
  const activity = new ActivityLog({ snapshot: () => sim.snapshot().id });
  const c = await connected(sim, activity);
  await c.client.listTools();
  await c.call('get_plant_overview');
  await c.call('get_signals', { ids: ['XMEAS(9)', 'XMV(10)'], window_minutes: 30 });
  await c.call('get_safety_state');
  await c.call('get_topology_impact', { node_id: 'reactor_cooling_water_in', max_hops: 3 });
  await c.call('get_engineering_context', { node_id: 'reactor' });
  const u = sim.plant.VAL['XMV(10)'];
  await c.call('simulate_adjustment', { xmv: 'XMV(10)', target: +(u + 3).toFixed(1), minutes: 30 });
  await c.call('propose_adjustment', { xmv: 'XMV(10)', target: +(u + 30).toFixed(1), rationale: 'test: too big a step on purpose' });
  await c.call('get_gate_log', { limit: 5 });
  await c.client.readResource({ uri: 'docs://system-prompt' });
  await c.client.getPrompt({ name: 'operator-assistant' });
  await c.call('get_signals', { ids: Array(9).fill('XMEAS(1)') }); // schema error
  await c.call('get_topology_impact', { node_id: 'nope' }); // tool-level error

  const L = activity.records;
  assert.ok(L.some((r) => r.kind === 'list' && r.name === 'tools/list' && r.summary === '8 tools'));
  for (const name of ['get_plant_overview', 'get_signals', 'get_safety_state', 'get_engineering_context', 'simulate_adjustment', 'get_gate_log']) {
    const r = toolRec(activity, name);
    assert.equal(r.outcome, 'ok', name);
    assert.match(r.snapshot ?? '', SNAP, name);
    assert.ok(r.summary.length > 0, name);
  }
  assert.match(toolRec(activity, 'get_plant_overview').summary, /^rules NORMAL, PCA score [\d.]+×.*loop AUTO [\d.]+ %, 6 modelled signals$/);
  assert.match(toolRec(activity, 'get_signals').summary, /^XMEAS\(9\) [\d.]+, XMV\(10\) [\d.]+ \(latest, 30\.0 min window\)$/);
  assert.equal(toolRec(activity, 'get_signals').args, 'ids=[XMEAS(9),XMV(10)] window_minutes=30');
  assert.match(toolRec(activity, 'get_safety_state').summary, /^rules NORMAL, PCA .+, top XMEAS\(\d+\), loop AUTO/);
  const topo = activity.records.filter((r) => r.name === 'get_topology_impact')[0];
  assert.equal(topo.outcome, 'ok');
  assert.match(topo.summary, /^from e:reactor_cooling_water_in, 3 hops: \d+ elements reachable/);
  assert.deepEqual(topo.focus, ['e:reactor_cooling_water_in']);
  assert.ok(topo.reach?.includes('n:reactor'));
  const ctx = toolRec(activity, 'get_engineering_context');
  assert.match(ctx.summary, /^Reactor \(n:reactor\): \d+ signals, \d+ rules, \d+ knowledge items$/);
  assert.deepEqual(ctx.focus, ['n:reactor']);
  assert.match(toolRec(activity, 'simulate_adjustment').summary, /^simulate XMV\(10\) [\d.]+ -> [\d.]+ % \(30 min\): worst NORMAL, end XMEAS\(9\) [\d.]+ vs [\d.]+ without/);
  const prop = toolRec(activity, 'propose_adjustment');
  assert.equal(prop.outcome, 'REJECT');
  assert.match(prop.summary, /^propose XMV\(10\) -> [\d.]+ %: REJECT STEP_TOO_LARGE\b/);
  assert.equal(prop.rationale, 'test: too big a step on purpose');
  assert.doesNotMatch(prop.args, /rationale/);
  assert.equal(prop.applied, false);
  assert.match(toolRec(activity, 'get_gate_log').summary, /^1 of 1 entries, newest #1 REJECT$/);
  const res = L.find((r) => r.kind === 'resource');
  assert.equal(res?.name, 'docs://system-prompt');
  assert.match(res?.summary ?? '', /^read [\d.]+ K? ?chars$/);
  const pr = L.find((r) => r.kind === 'prompt');
  assert.equal(pr?.name, 'operator-assistant');
  assert.equal(pr?.summary, '1 message');
  const schemaErr = L.filter((r) => r.name === 'get_signals').at(-1)!;
  assert.equal(schemaErr.outcome, 'error');
  assert.match(schemaErr.summary, /validation|invalid/i);
  assert.equal(L.at(-1)!.name, 'get_topology_impact');
  assert.equal(L.at(-1)!.outcome, 'error');
  assert.match(L.at(-1)!.summary, /Unknown node or edge id "nope"/);
  // seq strictly increasing, newest last
  for (let i = 1; i < L.length; i++) assert.equal(L[i].seq, L[i - 1].seq + 1);

  // the simulation overlay: both branches, from the snapshot it ran at
  const sv = activity.state().sim!;
  assert.ok(sv);
  assert.equal(sv.xmv, 'XMV(10)');
  assert.equal(sv.minutes, 30);
  assert.ok(sv.withChange.length >= 10 && sv.noChange.length === sv.withChange.length);
  assert.equal(typeof sv.withChange[0]['XMEAS(9)'], 'number');
  assert.match(sv.snapshot.id, SNAP);
  await c.close();
});

test('an accepted proposal is recorded as ACCEPT, applied', async () => {
  const sim = mk();
  const activity = new ActivityLog();
  const c = await connected(sim, activity);
  const u = sim.plant.VAL['XMV(10)'];
  await c.call('propose_adjustment', { xmv: 'XMV(10)', target: +(u + 2).toFixed(1), rationale: 'small move' });
  const r = toolRec(activity, 'propose_adjustment');
  assert.equal(r.outcome, 'ACCEPT');
  assert.equal(r.applied, true);
  assert.match(r.summary, /: ACCEPT, applied \(loop MANUAL\)$/);
  await c.close();
});

test('the activity log is a bounded ring', () => {
  const a = new ActivityLog({ cap: 5 });
  for (let i = 0; i < 12; i++) a.add({ kind: 'tool', name: 'get_safety_state', args: '', outcome: 'ok', summary: 's' + i });
  const st = a.state();
  assert.equal(st.records.length, 5);
  assert.equal(st.seq, 12);
  assert.deepEqual(st.records.map((r) => r.seq), [8, 9, 10, 11, 12]);
  const d = new ActivityLog();
  for (let i = 0; i < ACTIVITY_CAP + 50; i++) d.add({ kind: 'tool', name: 'x', args: '', outcome: 'ok', summary: '' });
  assert.equal(d.records.length, ACTIVITY_CAP);
  assert.equal(ACTIVITY_CAP, 200);
});

test('records never reveal the active scenario', async () => {
  const sim = mk();
  sim.injectIdv4(10, 'cli');
  sim.step(30);
  const activity = new ActivityLog({ snapshot: () => sim.snapshot().id });
  const c = await connected(sim, activity);
  await c.client.listTools();
  await c.client.listResources();
  for (const uri of ['manual://operating-manual', 'rules://limits', 'docs://architecture', 'docs://system-prompt']) await c.client.readResource({ uri });
  await c.client.getPrompt({ name: 'operator-assistant' });
  await c.call('get_plant_overview');
  await c.call('get_safety_state');
  await c.call('get_signals', { ids: ['XMEAS(9)', 'XMEAS(21)', 'XMV(10)'] });
  await c.call('get_topology_impact', { node_id: 'reactor_cooling_water_in' });
  await c.call('get_engineering_context', { node_id: 'reactor_cooling_water_in' });
  await c.call('simulate_adjustment', { xmv: 'XMV(10)', target: 50 });
  await c.call('propose_adjustment', { xmv: 'XMV(10)', target: 50, rationale: 'hold reactor temperature' });
  await c.call('get_gate_log', {});
  const text = JSON.stringify(activity.state());
  assert.ok(activity.records.length >= 14);
  assert.doesNotMatch(text, /IDV|disturbance|scenario|inject/i);
  await c.close();
});

test('untrusted text is stripped of control/bidi characters and length-capped server-side', async () => {
  assert.equal(cleanText('a' + ch(0) + 'b' + ch(0x202e) + 'c' + ch(10) + ch(9) + 'd', 50), 'a b c d');
  assert.equal(cleanText('x'.repeat(100), 10), 'x'.repeat(9) + '…');
  const emoji = String.fromCodePoint(0x1f600);
  assert.equal(cleanText('ab' + emoji, 3), 'ab…', 'never splits a surrogate pair');
  assert.equal(cleanText(undefined, 5), '');

  const sim = mk();
  const activity = new ActivityLog();
  const longName = '<img src=x onerror=alert(1)>' + 'n'.repeat(500) + ch(0x202e);
  const c = await connected(sim, activity, { name: longName, version: 'v'.repeat(300) });
  assert.ok(activity.client!.name.length <= MAX_CLIENT_FIELD_LEN);
  assert.ok(activity.client!.version.length <= MAX_CLIENT_FIELD_LEN);
  assert.ok(!activity.client!.name.includes(ch(0x202e)));
  const evil = '<script>alert(1)</script>' + ch(0x202e) + ch(7) + 'r'.repeat(480);
  await c.call('propose_adjustment', { xmv: 'XMV(10)<b>', target: 50, rationale: evil });
  await c.call('get_engineering_context', { node_id: '<svg onload=x>' + 'z'.repeat(40) });
  const prop = toolRec(activity, 'propose_adjustment');
  assert.ok((prop.rationale ?? '').length <= MAX_RATIONALE_LEN);
  assert.ok(prop.rationale!.startsWith('<script>'), 'kept as text; the page escapes it');
  assert.ok(!prop.rationale!.includes(ch(0x202e)) && !prop.rationale!.includes(ch(7)));
  for (const r of activity.records) {
    assert.ok(r.args.length <= MAX_ARGS_LEN);
    assert.ok(r.summary.length <= 200);
    assert.ok(r.name.length <= 64);
  }
  await c.close();

  // the page escapes every server-supplied field of a record and the client name
  const tpl = readFileSync(fileURLToPath(new URL('../web/index.template.html', import.meta.url)), 'utf8');
  const row = /function actRow\(r,isNew\)\{[\s\S]*?\n\}/.exec(tpl)![0];
  for (const f of ['esc(r.name)', 'esc(r.args)', 'esc(r.summary)', 'esc(r.snapshot)', 'esc(r.rationale', 'esc(tm)', 'esc(actKind(r.kind))']) assert.ok(row.includes(f), f);
  assert.doesNotMatch(row, /\+r\.(name|args|summary|rationale|snapshot)\b/);
  assert.match(tpl, /\$\('#cLlmT'\)\.textContent=txt/);
  assert.match(tpl, /setHTML\(\$\('#actStat'\),'<span class="dot'\+\(c\?' llmon':''\)\+'"><\/span>'\+esc\(txt\)\)/);
});

test('SSE: an activity event reaches a connected viewer as soon as the call finishes', async () => {
  const sim = createSimulation({ seed: 21 });
  const activity = new ActivityLog({ snapshot: () => sim.snapshot().id });
  const app = createWebApp({ sim, html: '<!doctype html><html lang="zh-Hant"><body>page</body></html>', controls: { running: false, speed: 1 }, activity });
  const port = await app.listen(0);
  const c = await connected(sim, activity, { name: 'sse-client', version: '1' });
  try {
    const got = await new Promise<string>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port, method: 'GET', path: '/api/stream?token=' + app.token, headers: { host: '127.0.0.1:' + port } }, (res) => {
        assert.equal(res.statusCode, 200);
        let text = '';
        let called = false;
        res.on('data', (d) => {
          text += d;
          if (!called && text.includes('event: init')) { called = true; void c.call('get_safety_state'); }
          if (/event: activity\ndata: .*get_safety_state/.test(text)) { res.destroy(); resolve(text); }
        });
        res.on('error', () => {});
      });
      r.on('error', reject);
      r.end();
      setTimeout(() => reject(new Error('no activity event within 5 s')), 5000).unref();
    });
    const init = JSON.parse(/event: init\ndata: (.*)\n/.exec(got)![1]);
    assert.equal(init.activity.client.name, 'sse-client');
    assert.ok(init.activity.records.some((x: ActivityRecord) => x.name === 'initialize'));
    const ev = JSON.parse(/event: activity\ndata: (.*get_safety_state.*)\n/.exec(got)![1]);
    assert.equal(ev.record.name, 'get_safety_state');
    assert.equal(ev.record.outcome, 'ok');
    assert.equal(ev.client.initialized, true);
    // and /api/state carries the same feed
    const state = await new Promise<string>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port, method: 'GET', path: '/api/state', headers: { host: '127.0.0.1:' + port, 'x-pcl-token': app.token } }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve(t)); });
      r.on('error', reject);
      r.end();
    });
    const j = JSON.parse(state);
    assert.equal(j.activity.records.at(-1).name, 'get_safety_state');
  } finally {
    await c.close();
    await app.close();
  }
});
