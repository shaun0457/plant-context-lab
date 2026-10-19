# Architecture (short)

```
src/engine/  plain TypeScript, no DOM
  plant.ts       lumped reactor-cooling model (moved from the page, same equations)
  rules.ts       reviewed limits -> NORMAL / ATTENTION / ALARM / TRIP, each with id + source
  pca.ts         T² / SPE monitor, trained offline (pca-model.json), no fault labels
  gate.ts        evaluateAdjustment(): deterministic ACCEPT / REJECT + reasons, gate log
  topology.ts    TEP process graph 0.2.0, downstream BFS (<= 6 hops)
  knowledge.ts   staged knowledge revision with fragment ids and review status
  simulation.ts  one plant state + capped history + safety + logs; branch() for simulate-before-act

web/index.template.html + engine IIFE  ->  index.html (static page, works offline)
src/server/    Node: one process, one engine instance
  web.ts   127.0.0.1 viewer, the same page in connected mode (SSE)
  mcp.ts   MCP tools / resources / prompt over stdio (optional Streamable HTTP)
```

## Authority

- **The model proposes; the gate decides.** `propose_adjustment` runs the gate, and only an ACCEPT changes the plant.
- **Scenarios are harness authority.** Disturbance injection, removal and the return to AUTO are human controls on the page or command-line flags. No MCP tool exists for them, and tool results do not reveal the active scenario.
- **The trust boundary is loopback.** The viewer accepts loopback Host headers only, and its controls need a same-origin request plus a per-process token, so other websites cannot drive it. A local process can still open the page. Give the agent MCP tools only, never a shell or fetch tool aimed at the viewer port.
- **Simulate-before-act runs on copies.** `branch()` copies the plant state and the RNG, so a branch replays the same noise. The live plant is never touched.

## Bounds

The engine keeps a history of 480 samples. Logs are capped: 200 gate entries, 100 events and 50 applied changes. `get_signals` returns at most 8 ids and 60 points each, `simulate_adjustment` runs at most 120 minutes, and impact queries go at most 6 hops. The viewer accepts 8 SSE clients and request bodies up to 8 KB.

## Honesty

The trends come from an illustrative lumped model, not the TEP simulator. The rules use only limits that were reviewed and approved. The ATTENTION band and the headroom check are labelled demo conventions. The PCA training data is simulated normal operation, so the thresholds describe this toy model only.
