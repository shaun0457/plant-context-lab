/**
 * plant-context-lab local server: one process, one shared engine instance,
 *   - a 127.0.0.1 web server serving the page in connected mode,
 *   - an MCP server over stdio (and optionally Streamable HTTP on 127.0.0.1).
 *
 * stdout belongs to the MCP stdio transport; all logging goes to stderr.
 */
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createSimulation } from '../engine/index.ts';
import { ActivityLog } from './activity.ts';
import { loadDocs, packageRoot } from './docs.ts';
import { createMcpServer, SERVER_VERSION } from './mcp.ts';
import type { ToolContext } from './tools.ts';
import { createWebApp, type Controls } from './web.ts';

export const SCENARIOS: Record<string, number> = { normal: 0, 'idv4-step5': 5, 'idv4-step10': 10 };

const HELP = `plant-context-lab ${SERVER_VERSION} (SIMULATED plant, education only)

Usage: plant-context-lab [options]

  --scenario <name>   normal | idv4-step5 | idv4-step10   (default normal; human-only)
  --port <n>          web viewer port on 127.0.0.1 (default 8787, tries the next 9 if busy)
  --tick-ms <n>       real milliseconds per simulation tick (default 1000; 1 tick = 0.6 sim min)
  --seed <n>          noise seed (default: random)
  --no-web            do not start the web viewer
  --http-mcp          also serve MCP over Streamable HTTP at http://127.0.0.1:<port>/mcp
  --stdio             force MCP over stdio even when stdin is a terminal
  -h, --help          show this help
`;

function log(msg: string) { process.stderr.write('[plant-context-lab] ' + msg + '\n'); }

async function main() {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', default: 'normal' },
      port: { type: 'string', default: '8787' },
      'tick-ms': { type: 'string', default: '1000' },
      seed: { type: 'string' },
      'no-web': { type: 'boolean', default: false },
      'http-mcp': { type: 'boolean', default: false },
      stdio: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) { process.stderr.write(HELP); return; }
  const scenario = String(values.scenario);
  if (!(scenario in SCENARIOS)) throw new Error('unknown scenario "' + scenario + '" (use ' + Object.keys(SCENARIOS).join(', ') + ')');
  const port = Math.max(1, Math.min(65535, parseInt(String(values.port), 10) || 8787));
  const tickMs = Math.max(100, Math.min(10000, parseInt(String(values['tick-ms']), 10) || 1000));
  const seed = values.seed !== undefined ? (parseInt(String(values.seed), 10) >>> 0) : (Date.now() >>> 0);

  const sim = createSimulation({ seed });
  if (SCENARIOS[scenario] > 0) sim.injectIdv4(SCENARIOS[scenario], 'cli');
  const docs = loadDocs();
  // every MCP request (stdio or HTTP) is reported to the viewer's LLM activity feed
  const activity = new ActivityLog({ snapshot: () => sim.snapshot().id });
  const ctx: ToolContext = { sim, activity };
  // the viewer URL is for the human (stderr); tool results never point the LLM at the viewer port
  let viewerUrl: string | null = null;
  const controls: Controls = { running: true, speed: 1 };

  let web: ReturnType<typeof createWebApp> | null = null;
  if (!values['no-web']) {
    const html = readFileSync(join(packageRoot(), 'index.html'), 'utf8');
    const mcpHttp = values['http-mcp']
      ? async (req: IncomingMessage, res: ServerResponse, body: unknown) => {
          const server = createMcpServer(ctx, docs, { statelessHttp: true });
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
        }
      : undefined;
    try {
      web = createWebApp({ sim, html, controls, mcpHttp, activity, log });
      const bound = await web.listen(port, '127.0.0.1');
      viewerUrl = 'http://127.0.0.1:' + bound + '/';
      log('viewer (connected mode): ' + viewerUrl);
      if (mcpHttp) log('MCP Streamable HTTP: http://127.0.0.1:' + bound + '/mcp');
    } catch (e) {
      // The viewer is optional: keep serving MCP over stdio without it.
      web = null;
      log('web viewer not started (' + (e as Error).message + '); continuing with MCP only');
    }
  }
  log('scenario: ' + scenario + ' · seed ' + seed + ' · tick ' + tickMs + ' ms = 0.6 simulated min');

  const timer = setInterval(() => {
    // Paused: no simulation step, but still push so gate/event changes made over MCP reach viewers.
    if (!controls.running) { web?.broadcast([]); return; }
    const samples = [];
    for (let i = 0; i < controls.speed; i++) { sim.step(); samples.push(sim.sample()); }
    web?.broadcast(samples);
  }, tickMs);

  let closing = false;
  const shutdown = async (why: string) => {
    if (closing) return;
    closing = true;
    log('shutting down (' + why + ')');
    clearInterval(timer);
    setTimeout(() => process.exit(0), 2000).unref();
    if (web) await web.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  if (!process.stdin.isTTY || values.stdio) {
    const server = createMcpServer(ctx, docs);
    const transport = new StdioServerTransport();
    transport.onclose = () => { void shutdown('MCP stdio closed'); };
    process.stdin.on('end', () => { void shutdown('stdin ended'); });
    await server.connect(transport);
    log('MCP server on stdio' + (viewerUrl ? '; watch at ' + viewerUrl + ' (every tool call appears in its LLM activity panel)' : ''));
  } else {
    log('stdin is a terminal: MCP stdio not started (an MCP client starts this command itself). Ctrl+C to stop.');
  }
}

main().catch((e) => { log('fatal: ' + (e as Error).message); process.exit(1); });
