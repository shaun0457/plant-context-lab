/**
 * MCP wiring: tools, resources and the operator-assistant prompt over the shared
 * engine. Transport-agnostic (stdio in main.ts, in-memory in tests, optional
 * Streamable HTTP on 127.0.0.1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GATE_PARAMS, MAX_HOPS, MAX_SIGNAL_IDS, RULES } from '../engine/index.ts';
import type { Docs } from './docs.ts';
import { MAX_SIM_MINUTES, createToolHandlers, type ToolContext } from './tools.ts';

export const SERVER_NAME = 'plant-context-lab';
export const SERVER_VERSION = '0.3.0';

function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function createMcpServer(ctx: ToolContext, docs: Docs): McpServer {
  const h = createToolHandlers(ctx);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: 'Simulated Tennessee Eastman reactor-cooling demo for education only. Read resource docs://system-prompt (or prompt operator-assistant) first. Always call get_safety_state before advising. The gate decides; you only propose.' },
  );

  server.registerTool('get_plant_overview', {
    title: 'Plant overview',
    description: 'Read-only overview of the SIMULATED plant: topology counts, modelled signals with current values, the XMV(10) loop mode, a safety summary and the snapshot id.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => asContent(h.get_plant_overview()));

  server.registerTool('get_signals', {
    title: 'Signal history',
    description: 'Read-only recent values for up to ' + MAX_SIGNAL_IDS + ' signal ids (e.g. "XMEAS(9)", "XMV(10)") over a window in simulated minutes; at most 60 points per signal.',
    inputSchema: {
      ids: z.array(z.string().max(16)).min(1).max(MAX_SIGNAL_IDS).describe('Signal ids such as XMEAS(9), XMEAS(21), XMV(10)'),
      window_minutes: z.number().min(0.6).max(288).optional().describe('Window in simulated minutes (default 30, max 288)'),
    },
    annotations: READ_ONLY,
  }, async (a) => asContent(h.get_signals(a)));

  server.registerTool('get_safety_state', {
    title: 'Safety state',
    description: 'Read-only rule states (NORMAL/ATTENTION/ALARM/TRIP with rule ids and sources) plus the PCA anomaly score (T², SPE, thresholds, top contributing variables). Call this first.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => asContent(h.get_safety_state()));

  server.registerTool('get_topology_impact', {
    title: 'Topology impact',
    description: 'Read-only downstream reachability from a node or edge id, up to ' + MAX_HOPS + ' hops, with loops flagged. Reachability is not causation.',
    inputSchema: {
      node_id: z.string().max(64).describe('Node or edge id, e.g. "reactor" or "reactor_cooling_water_in"'),
      max_hops: z.number().int().min(1).max(MAX_HOPS).optional().describe('1..' + MAX_HOPS + ' (default 3)'),
    },
    annotations: READ_ONLY,
  }, async (a) => asContent(h.get_topology_impact(a)));

  server.registerTool('get_engineering_context', {
    title: 'Engineering context',
    description: 'Read-only bound signals, reviewed limits, SOP excerpts and control relations for a node or edge id, each with knowledge refs.',
    inputSchema: { node_id: z.string().max(64).describe('Node or edge id, e.g. "reactor"') },
    annotations: READ_ONLY,
  }, async (a) => asContent(h.get_engineering_context(a)));

  server.registerTool('simulate_adjustment', {
    title: 'Simulate adjustment (branch only)',
    description: 'Runs a branch copy of the engine ahead with the change applied and without it, and returns both summaries. Never changes the live plant and is not a gate verdict.',
    inputSchema: {
      xmv: z.string().max(16).describe('Manipulated variable id; only XMV(10) is modelled'),
      target: z.number().min(GATE_PARAMS.xmvMin).max(GATE_PARAMS.xmvMax).describe('Target output, %'),
      minutes: z.number().min(1).max(MAX_SIM_MINUTES).optional().describe('Simulated minutes ahead (default ' + GATE_PARAMS.horizonMin + ', max ' + MAX_SIM_MINUTES + ')'),
    },
    annotations: READ_ONLY,
  }, async (a) => asContent(h.simulate_adjustment(a)));

  server.registerTool('propose_adjustment', {
    title: 'Propose adjustment (gated)',
    description: 'Submits a proposal to the deterministic gate. The gate returns ACCEPT or REJECT with machine-readable reasons; only an ACCEPT is applied (the XMV(10) loop goes to MANUAL at the target). Returns the snapshot id. Do not retry to get around a REJECT.',
    inputSchema: {
      xmv: z.string().max(16).describe('Manipulated variable id, e.g. XMV(10)'),
      target: z.number().describe('Target output, % (0..100)'),
      rationale: z.string().min(1).max(GATE_PARAMS.rationaleMaxLen).describe('Why, citing signal ids, rule ids and the snapshot id'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => asContent(h.propose_adjustment(a)));

  server.registerTool('get_gate_log', {
    title: 'Gate log',
    description: 'Read-only recent gate evaluations (newest first) with timestamp, snapshot id, inputs, verdict and reasons.',
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    annotations: READ_ONLY,
  }, async (a) => asContent(h.get_gate_log(a)));

  const md = (uri: string, text: string) => ({ contents: [{ uri, mimeType: 'text/markdown', text }] });
  server.registerResource('operating-manual', 'manual://operating-manual', { title: 'Operating manual', description: 'Signals, normal envelope, IDV(4) response pattern, investigation steps', mimeType: 'text/markdown' },
    async (uri) => md(uri.href, docs.operatingManual));
  server.registerResource('rules-limits', 'rules://limits', { title: 'Rule limits', description: 'Rule ids, limits, states and sources, plus the gate parameters (JSON)', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ rules: RULES, gate: GATE_PARAMS, markdown: docs.rules }, null, 2) }] }));
  server.registerResource('architecture', 'docs://architecture', { title: 'Architecture', description: 'One engine, two front ends, gate authority', mimeType: 'text/markdown' },
    async (uri) => md(uri.href, docs.architecture));
  server.registerResource('system-prompt', 'docs://system-prompt', { title: 'System prompt', description: 'Operator-assistant system prompt', mimeType: 'text/markdown' },
    async (uri) => md(uri.href, docs.systemPrompt));

  server.registerPrompt('operator-assistant', {
    title: 'Operator assistant',
    description: 'System prompt for an assistant that advises on the simulated plant through these tools.',
  }, async () => ({
    description: 'Operator-assistant system prompt (simulated plant, education only)',
    messages: [{ role: 'user', content: { type: 'text', text: docs.systemPrompt } }],
  }));

  return server;
}
