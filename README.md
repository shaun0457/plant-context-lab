# Plant Context Lab

> **繁體中文摘要：** 以 Tennessee Eastman 製程（TEP）為例的工業 context layer 概念示範。網頁本身離線可用，有 P&ID、瀏覽器內模擬的即時趨勢與 IDV(4) 擾動注入，並加入三層確定性的安全機制：已審核限值的規則（NORMAL / ATTENTION / ALARM / TRIP）、離線訓練的 PCA 異常監測（只輸出分數與貢獻變數，不輸出故障標籤），以及「先模擬再執行」的調整 gate。想讓自己的 LLM 參與的話，可以在本機啟動選用的 MCP server：LLM 只能提議，由 gate 決定是否套用；擾動注入只能由人操作。**全部都是模擬，僅供教學，不可用於實際工廠操作。**

An interactive concept demo of an industrial context layer, built on the Tennessee Eastman process (TEP).

**Live page:** https://shaun0457.github.io/plant-context-lab/

> **Simulation only.** The plant is an illustrative lumped model of the TEP reactor-cooling subsystem. The rules, the PCA monitor, the gate and any LLM advice built on them are for education only. Do not use any of it for real plant operation.

## What it shows

- **Plant view.** A TEP flowsheet in P&ID style, with a switch to a graph view of the same 17 units and 18 streams. Click a unit to see its bound signals, the reviewed engineering knowledge that applies to it, and how far its effects reach downstream (up to 6 hops, loops flagged).
- **Live trends with disturbance injection.** Inject a step in reactor cooling-water inlet temperature, TEP disturbance IDV(4), and watch the cooling-water valve take up the disturbance while the effect lights up across the flowsheet, hop by hop.
- **"What is happening now."** A structured summary of the reactor-cooling subsystem. Every line cites its signal ids, rule ids, knowledge refs and the exact snapshot (event horizon T, ingest cutoff K).
- **Safety status bar.** The worst rule state with its rule id, the PCA anomaly score against its 99 % threshold, the top contributing variables, and the XMV(10) loop mode.
- **Adjustment proposal (調整提案).** Pick an XMV and a target, then press 試算 (dry run). 套用 (apply) works only after the gate returns ACCEPT. Every evaluation goes to the **gate log**.

## Two ways to use it

### 1. Just open the page

Open the [live page](https://shaun0457.github.io/plant-context-lab/), or open `index.html` from a clone. It is one self-contained file with no network requests. The engine runs in your browser.

### 2. Local MCP mode: let your own LLM advise

One local Node process holds **one engine instance** and exposes it twice:

- a viewer at `http://127.0.0.1:8787/`, which is the same page in **connected mode**: it shows the server's engine live over Server-Sent Events, and its controls drive the server engine, so you can watch what your LLM does;
- an **MCP server over stdio** for MCP clients such as Claude Desktop or Cursor. Streamable HTTP is optional.

Requires Node.js 22.18 or later.

```bash
# run straight from GitHub
npx -y github:shaun0457/plant-context-lab

# or from a clone
npm install
npm start
```

Options (scenarios are **human-only**; no agent tool can change them):

```text
--scenario normal | idv4-step5 | idv4-step10   start with an IDV(4) step already injected
--port 8787          viewer port on 127.0.0.1 (tries the next 9 if busy)
--tick-ms 1000       real ms per tick; 1 tick = 0.6 simulated min
--seed <n>           noise seed
--no-web             MCP only, no viewer
--http-mcp           also serve MCP over Streamable HTTP at http://127.0.0.1:<port>/mcp
--stdio              force stdio when stdin is a terminal
```

When you run `npm start` in a terminal, only the viewer starts. Your MCP client launches its own copy with stdio attached.

#### Claude Desktop (stdio)

Add this to `claude_desktop_config.json`, restart Claude Desktop, then open `http://127.0.0.1:8787/` to watch:

```json
{
  "mcpServers": {
    "plant-context-lab": {
      "command": "npx",
      "args": ["-y", "github:shaun0457/plant-context-lab", "--scenario", "idv4-step5"]
    }
  }
}
```

On Windows, if `npx` is not found, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "github:shaun0457/plant-context-lab"]`. From a clone you can point at the built file instead: `"command": "node", "args": ["/path/to/plant-context-lab/dist/server.js"]`.

#### Cursor or any other MCP client

- **stdio:** command `npx`, args `-y github:shaun0457/plant-context-lab`. From a clone, use `node dist/server.js`.
- **Streamable HTTP:** start with `--http-mcp` and connect to `http://127.0.0.1:8787/mcp`. This endpoint is stateless and accepts loopback Host and Origin only.

Security note: the viewer and `/mcp` listen on 127.0.0.1 only, reject foreign Host headers (DNS rebinding) and cross-site requests, and the page controls need a per-process token. The trust boundary is your own machine: any local process can open the viewer. Do not give the LLM a shell or web-fetch tool pointed at the viewer port, because its intended path is the MCP tools only. To run a fixed version rather than the latest commit, use `npx -y github:shaun0457/plant-context-lab#<tag-or-commit>`.

Then ask: *"Use the operator-assistant prompt. What is happening in the plant, and should I adjust anything?"*

#### What the MCP server exposes

| Tool | Behaviour |
|---|---|
| `get_plant_overview` | Read-only overview: topology counts, modelled signals, loop mode, safety summary |
| `get_signals(ids, window_minutes)` | Read-only history; at most 8 ids, 60 points each, 288 min window |
| `get_safety_state` | Rule states with rule ids and sources, plus PCA T², SPE, thresholds and contributors |
| `get_topology_impact(node_id, max_hops)` | Downstream reachability, at most 6 hops. Reachability is not causation |
| `get_engineering_context(node_id)` | Bound signals, reviewed limits, SOP excerpts, with knowledge refs |
| `simulate_adjustment(xmv, target, minutes)` | Branch copy only, with and without the change; never mutates; up to 120 min |
| `propose_adjustment(xmv, target, rationale)` | Runs the gate, applies only on ACCEPT; returns verdict, reasons and snapshot id |
| `get_gate_log` | Recent gate evaluations |

Every result carries a snapshot id (`snap@T<h>h/K<n>`) and refs. There is **no tool to inject a disturbance, reset the plant or return the loop to AUTO**, and results never reveal the active scenario. Incident injection is harness authority, never an agent tool. The human uses the page or the command-line flags.

Resources: `manual://operating-manual`, `rules://limits`, `docs://architecture`, `docs://system-prompt`. Prompt: `operator-assistant`.

#### Without MCP

Paste [`docs/system-prompt.md`](docs/system-prompt.md) as the system prompt and [`docs/operating-manual.md`](docs/operating-manual.md) plus [`docs/rules.md`](docs/rules.md) as context into any chat model, together with numbers you read off the page.

## Safety layers

All three layers live in one engine (`src/engine/`, plain TypeScript with no DOM access). The static page and the server share it.

### Rules

Only limits that were approved in the staged knowledge revision shown on the page are used. Both limits are also published by Downs & Vogel (1993).

| Rule id | Signal | Condition | State | Source |
|---|---|---|---|---|
| `RL-XMEAS9-ATT` | `XMEAS(9)` reactor temperature | ≥ 142.6 degC | ATTENTION | derived: last 25 % of headroom to 150 (demo convention) |
| `RL-XMEAS9-NU` | `XMEAS(9)` | > 150 degC (normal upper) | ALARM | tags-and-limits/row-2, review-05/06 APPROVE; Downs & Vogel (1993) |
| `RL-XMEAS9-SD` | `XMEAS(9)` | ≥ 175 degC (shutdown) | TRIP | same |
| `RL-XMEAS7-ATT` | `XMEAS(7)` reactor pressure | ≥ 2847.5 kPa gauge | ATTENTION | derived: last 25 % of headroom to 2895 (demo convention) |
| `RL-XMEAS7-NU` | `XMEAS(7)` | > 2895 kPa gauge (normal upper) | ALARM | tags-and-limits/row-1, review-02/03 APPROVE; Downs & Vogel (1993) |
| `RL-XMEAS7-SD` | `XMEAS(7)` | ≥ 3000 kPa gauge (shutdown) | TRIP | same |

Every other signal is reported as **"no reviewed limit"** and never guessed. `XMEAS(21)` has an explicit reviewed statement that its limits are unspecified. The rejected "145 degC" claim is never used. Downs & Vogel also give level constraints. They are left out because they are not in the reviewed knowledge, their shutdown values are volumes that would need an unsourced conversion to the % measurement, and the model does not simulate levels. The lumped model has no interlock: TRIP is reported, not executed. The generated table with full sources is in [`docs/rules.md`](docs/rules.md).

### PCA monitor

- **Variables:** the six signals with dynamics in the model, `XMEAS(7)`, `XMEAS(9)`, `XMEAS(11)`, `XMEAS(13)`, `XMEAS(21)` and `XMV(10)`, as a 5-sample moving mean, autoscaled.
- **Training:** `npm run train:pca` (`scripts/train-pca.ts`) generates normal operation from the engine itself. It uses seeds 101–606, 30 simulated hours each, about 18,000 rows. The loop runs in AUTO with no disturbance, plus small operator moves of ±3 % held for 18–54 minutes, so that the monitor learns how the plant normally responds to the valve.
- **Model:** 2 components (99 % of the variance). The thresholds are empirical 99 % quantiles: T² ≈ 11.74 and SPE ≈ 0.461. The hold-out false-alarm rate is under 1 %. Everything is stored in `src/engine/pca-model.json`.
- **Output:** T², SPE, a score (the larger of the two ratios to their thresholds), whether each threshold is exceeded, and the top contributing variables. **There is no fault classifier.** The monitor never outputs an IDV id or a fault class.

### Adjustment gate

`evaluateAdjustment(sim, {xmv, target, rationale})` returns ACCEPT or REJECT with machine-readable reason codes. Every check is evaluated, and every evaluation is logged with a timestamp, the snapshot id, the inputs, the verdict and the reasons.

| Check | Parameter |
|---|---|
| XMV exists and is modelled | Only `XMV(10)` is simulated. Other XMVs return `XMV_NOT_MODELLED` |
| Range | 0–100 % |
| Max step per action | 10 %-points from the current output |
| Max rate | 15 %-points of applied change per XMV within 10 simulated minutes |
| No adjustment during TRIP | `TRIP_ACTIVE`: escalate to a human |
| Simulate before act | Runs a branch copy 30 simulated minutes ahead, with and without the change, using the same noise. Rejects on any ALARM or TRIP (when ALARM/TRIP happens anyway without the change, only if the change makes the worst state or a ruled peak worse, so corrective moves stay possible); on a rise in a ruled signal's peak of more than 5 % of its nominal headroom (demo convention); or on a mean SPE more than one SPE limit worse than no change |

An ACCEPT puts the XMEAS(9) → XMV(10) loop in MANUAL at the target. Returning to AUTO is a human button on the page. The gate is deliberately conservative: it checks a safety envelope, not whether a move is wise. Under IDV(4), the PI controller has usually compensated already, so the right advice is often "no adjustment".

## Development

```bash
npm install
npm run build     # typecheck, inline the engine into index.html, bundle dist/server.js, regenerate docs/rules.md
npm test          # node:test over engine, rules, PCA, gate, MCP handlers, viewer server, build freshness
npm run train:pca # regenerate src/engine/pca-model.json (then npm run build)
```

`index.html` is a build output of `web/index.template.html` plus the engine bundle, and is committed because GitHub Pages serves it directly. `dist/` is committed too. That way `npx github:shaun0457/plant-context-lab` only installs the two runtime dependencies (the MCP SDK and zod) and needs no build toolchain on the visitor's machine. A test fails if either output is stale relative to the sources.

```text
src/engine/   plant model, rules, PCA, gate, topology, knowledge, simulation (shared)
src/server/   web viewer (127.0.0.1), MCP tools/resources/prompt, CLI entry
web/          page template
scripts/      build and PCA training
docs/         system prompt, operating manual, architecture, generated rules
test/         node:test suites
```

## Honesty notes

- The trends are **simulated in the browser**, or on your machine in connected mode, for illustration. They are not output from the TEP simulator. The plant model is the same lumped model in both modes.
- The topology and signal bindings come from a human-verified TEP process graph. The flowsheet layout is hand-drawn after the classic TEP flowsheet.
- The rule limits come from reviewed knowledge. The ATTENTION band and the headroom check are labelled demo conventions. The PCA thresholds describe this toy model only.
- The underlying platform is developed in [tep-agent-lab](https://github.com/shaun0457/tep-agent-lab):
  - **Implemented:** live plant streaming through canonical telemetry; engineering-knowledge extraction with human review.
  - **In progress:** plant context composition and the UI read of pinned snapshots.

A later version will replay recorded runs from the real platform instead of the browser simulation.

## References

- J. J. Downs and E. F. Vogel, "A plant-wide industrial process control problem," *Computers & Chemical Engineering*, 17(3), 1993.
- A. Bathelt, N. L. Ricker and M. Jelali, "Revision of the Tennessee Eastman process model," *IFAC-PapersOnLine*, 48(8), 2015.

The static page is a single self-contained HTML file with no external requests.
