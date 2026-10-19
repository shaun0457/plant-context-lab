// MCP tool handlers, called in-process, plus the real MCP wiring over an
// in-memory transport (tools / resources / prompts lists and calls).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSimulation } from '../src/engine/index.ts';
import { loadDocs } from '../src/server/docs.ts';
import { createMcpServer } from '../src/server/mcp.ts';
import { createToolHandlers } from '../src/server/tools.ts';

const mk = () => createSimulation({ seed: 7, now: () => 0 });
const SNAP = /^snap@T\d+\.\d{2}h\/K\d+$/;

function hasSnapAndRefs(r: Record<string, unknown>) {
  assert.match((r.snapshot as { id: string }).id, SNAP);
  assert.ok(Array.isArray(r.refs) && (r.refs as unknown[]).length > 0, 'refs present');
}

test('handlers: every result carries snapshot id and refs', () => {
  const h = createToolHandlers({ sim: mk() });
  const results = [
    h.get_plant_overview(),
    h.get_signals({ ids: ['XMEAS(9)'], window_minutes: 10 }),
    h.get_safety_state(),
    h.get_topology_impact({ node_id: 'reactor', max_hops: 2 }),
    h.get_engineering_context({ node_id: 'reactor' }),
    h.simulate_adjustment({ xmv: 'XMV(10)', target: 42, minutes: 10 }),
    h.propose_adjustment({ xmv: 'XMV(10)', target: 99, rationale: 'x' }),
    h.get_gate_log({}),
  ];
  for (const r of results) { assert.equal(r.ok, true); hasSnapAndRefs(r); }
});

test('get_signals is bounded in ids and points', () => {
  const h = createToolHandlers({ sim: mk() });
  const ids = Array.from({ length: 12 }, (_, i) => 'XMEAS(' + (i + 1) + ')');
  const r = h.get_signals({ ids, window_minutes: 9999 }) as Record<string, any>;
  assert.equal(r.signals.length, 8);
  assert.equal(r.droppedIds.length, 4);
  for (const s of r.signals) assert.ok(s.points.length <= 60);
  assert.ok(r.windowMinutes <= 288);
  const u = h.get_signals({ ids: ['XMEAS(99)'] }) as Record<string, any>;
  assert.deepEqual(u.unknownIds, ['XMEAS(99)']);
  assert.equal(h.get_signals({ ids: [] }).ok, false);
});

test('topology impact capped at 6 hops; engineering context has refs; unknown ids fail cleanly', () => {
  const h = createToolHandlers({ sim: mk() });
  const r = h.get_topology_impact({ node_id: 'reactor_cooling_water_in', max_hops: 50 }) as Record<string, any>;
  assert.equal(r.impact.maxHops, 6);
  assert.ok(r.impact.hops.every((x: { hop: number }) => x.hop <= 6));
  assert.match(r.impact.caveat, /not causal evidence/i);
  const c = h.get_engineering_context({ node_id: 'e:reactor_cooling_water_out' }) as Record<string, any>;
  assert.ok(c.context.knowledge.length >= 1);
  assert.match(c.context.coverage, /explicitly unspecified/);
  assert.equal(c.context.signals[0].limits, 'no reviewed limit');
  assert.equal(h.get_topology_impact({ node_id: 'nope' }).ok, false);
  assert.equal(h.get_engineering_context({ node_id: 'nope' }).ok, false);
});

test('simulate_adjustment never mutates; propose REJECT then ACCEPT', () => {
  const sim = mk();
  const h = createToolHandlers({ sim });
  const before = JSON.stringify(sim.plant);
  const s = h.simulate_adjustment({ xmv: 'XMV(10)', target: 20, minutes: 60 }) as Record<string, any>;
  assert.equal(s.branchOnly, true);
  assert.equal(JSON.stringify(sim.plant), before);
  assert.equal(h.simulate_adjustment({ xmv: 'XMV(3)', target: 20 }).ok, false);
  const u = sim.plant.VAL['XMV(10)'];
  const rej = h.propose_adjustment({ xmv: 'XMV(10)', target: u + 30, rationale: 'too big' }) as Record<string, any>;
  assert.equal(rej.verdict, 'REJECT');
  assert.equal(rej.applied, false);
  assert.equal(rej.reasons[0].code, 'STEP_TOO_LARGE');
  const acc = h.propose_adjustment({ xmv: 'XMV(10)', target: +(u + 2).toFixed(1), rationale: 'small' }) as Record<string, any>;
  assert.equal(acc.verdict, 'ACCEPT');
  assert.equal(acc.applied, true);
  assert.equal(sim.plant.mode, 'MANUAL');
  const log = h.get_gate_log({ limit: 5 }) as Record<string, any>;
  assert.equal(log.entries[0].verdict, 'ACCEPT');
  assert.equal(log.entries[0].source, 'mcp');
  assert.equal(log.entries[1].verdict, 'REJECT');
});

test('agent-facing results never reveal the injected scenario', () => {
  const sim = mk();
  sim.injectIdv4(10, 'cli');
  sim.step(30);
  const h = createToolHandlers({ sim });
  const text = JSON.stringify([h.get_plant_overview(), h.get_safety_state(), h.get_signals({ ids: ['XMEAS(21)', 'XMV(10)'] }), h.get_gate_log({})]);
  assert.doesNotMatch(text, /IDV|disturbance|scenario|inject/i);
});

test('MCP wiring: lists tools, resources, prompt; no inject/reset tool; calls work', async () => {
  const sim = mk();
  const server = createMcpServer({ sim }, loadDocs());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ['get_engineering_context', 'get_gate_log', 'get_plant_overview', 'get_safety_state', 'get_signals', 'get_topology_impact', 'propose_adjustment', 'simulate_adjustment']);
  assert.ok(!tools.some((t) => /inject|reset|disturb|scenario|auto/i.test(t)));
  const res = (await client.listResources()).resources.map((r) => r.uri).sort();
  assert.deepEqual(res, ['docs://architecture', 'docs://system-prompt', 'manual://operating-manual', 'rules://limits']);
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  assert.deepEqual(prompts, ['operator-assistant']);
  const p = await client.getPrompt({ name: 'operator-assistant' });
  const ptxt = (p.messages[0].content as { text: string }).text;
  for (const must of [/SIMULATED/, /education only/i, /get_safety_state/, /snapshot/i, /gate decides/i, /bypass the gate/i, /Simulate before proposing/i, /uncertainty/i, /not causation/i, /TRIP/]) assert.match(ptxt, must);
  const rules = await client.readResource({ uri: 'rules://limits' });
  assert.match((rules.contents[0] as { text: string }).text, /RL-XMEAS9-SD/);
  const s = await client.callTool({ name: 'get_safety_state', arguments: {} });
  const sj = JSON.parse((s.content as { text: string }[])[0].text);
  assert.equal(sj.rules.worst.state, 'NORMAL');
  const bad = await client.callTool({ name: 'get_signals', arguments: { ids: Array(9).fill('XMEAS(1)') } });
  assert.equal(bad.isError, true, 'schema bound on ids is enforced');
  await client.close();
  await server.close();
});
