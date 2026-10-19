/**
 * MCP tool handlers as plain functions over the shared Simulation, so they can be
 * tested in-process. Every result carries a snapshot id and refs.
 *
 * There is deliberately no handler that injects a disturbance, resets the plant or
 * returns the loop to AUTO: scenarios are harness authority (the human on the page
 * or CLI flags), never an agent tool. Results never reveal the injected scenario.
 */
import {
  GATE_PARAMS, KR, MAX_HOPS, MAX_SIGNAL_IDS, MAX_SIGNAL_POINTS, MINUTES_PER_STEP, MODELLED_XMVS, RULES, SIG, XMV_IDS,
  evaluateAdjustment, getEngineeringContext, impact, resolveElement, simulateAhead, topologySummary,
  type GateLogEntry, type Simulation,
} from '../engine/index.ts';

export const DISCLAIMER = 'SIMULATED plant (illustrative lumped model of the Tennessee Eastman reactor-cooling subsystem). Education only; not for real plant operation.';

const REF_TOPO = 'tep-process-graph 0.2.0 · HUMAN_VERIFIED';
const REF_DV = 'Downs & Vogel (1993)';
const REF_BRJ = 'Bathelt, Ricker & Jelali (2015)';
const REF_PCA = 'pca-model.json (pca-monitor/1, trained offline on simulated normal operation)';
const REF_GATE = 'gate params: maxStep ' + GATE_PARAMS.maxStepPct + ' %, rate ' + GATE_PARAMS.maxChangeInWindowPct + ' %/' + GATE_PARAMS.rateWindowMin + ' min, horizon ' + GATE_PARAMS.horizonMin + ' min';

export const MAX_SIM_MINUTES = 120;

export type ToolResult = Record<string, unknown> & { ok: boolean; snapshot: unknown; refs: string[] };

function ruleRefs(): string[] {
  return RULES.map((r) => r.id + (r.source.knowledge ? ' · ' + r.source.knowledge : ' · derived from ' + r.source.derivedFrom));
}

function round(v: number, d = 3): number { return +(+v).toFixed(d); }

export interface ToolContext { sim: Simulation; viewerUrl?: string | null }

export function createToolHandlers(ctx: ToolContext) {
  const { sim } = ctx;

  function base(refs: string[]): { snapshot: ReturnType<Simulation['snapshot']>; refs: string[]; disclaimer: string } {
    return { snapshot: sim.snapshot(), refs, disclaimer: DISCLAIMER };
  }

  function err(message: string, refs: string[] = []): ToolResult {
    return { ok: false, error: message, ...base(refs) };
  }

  return {
    get_plant_overview(): ToolResult {
      const s = sim.safety();
      const topo = topologySummary();
      const v = sim.plant.VAL;
      return {
        ok: true,
        ...base([REF_TOPO, REF_DV, REF_BRJ, REF_PCA]),
        plant: 'Tennessee Eastman process, reactor-cooling subsystem (simulated)',
        topology: { revision: topo.revision, counts: topo.counts, nodes: topo.nodes.map((n) => n.id), loops: topo.loops },
        modelled: {
          signals: topo.modelledSignals.map((id) => ({ id, name: SIG[id][0], unit: SIG[id][1], nominal: SIG[id][2], value: round(v[id]) })),
          adjustableXmvs: MODELLED_XMVS.slice(),
          note: 'Only these signals have dynamics. Other XMEAS/XMV are noisy constants around nominal; other XMVs cannot be adjusted.',
        },
        loop: { controlled: 'XMEAS(9)', setpoint_degC: 120.40, manipulated: 'XMV(10)', mode: s.loop.mode, output: s.loop.output,
          note: 'An accepted adjustment puts the loop in MANUAL at the target. Only a human can return it to AUTO (page button).' },
        safetySummary: { worstRuleState: s.rules.worst.state, worstRuleId: s.rules.worst.ruleId, pcaScore: s.pca ? s.pca.score : null, pcaExceeded: s.pca ? s.pca.exceeded.any : null },
        timebase: { minutesPerSample: MINUTES_PER_STEP, simTime_h: round(sim.t, 2) },
        viewer: ctx.viewerUrl || null,
        nextStep: 'Call get_safety_state first, then get_signals / get_engineering_context. Use simulate_adjustment before propose_adjustment.',
      };
    },

    get_signals(args: { ids: string[]; window_minutes?: number }): ToolResult {
      const ids = Array.isArray(args?.ids) ? args.ids : [];
      if (!ids.length) return err('ids must be a non-empty array of signal ids such as "XMEAS(9)".');
      const w = sim.signalWindow(ids, args.window_minutes ?? 30, MAX_SIGNAL_POINTS);
      return {
        ok: true,
        ...base([REF_TOPO, REF_BRJ, REF_DV, 'browser-simulated values (illustrative)']),
        limits: { maxIds: MAX_SIGNAL_IDS, maxPoints: MAX_SIGNAL_POINTS, maxWindowMinutes: round(sim.historyCap * MINUTES_PER_STEP, 1) },
        windowMinutes: w.windowMinutes,
        signals: w.signals,
        unknownIds: w.unknown,
        droppedIds: w.truncatedIds,
        pointFormat: '[sim time h, value]',
      };
    },

    get_safety_state(): ToolResult {
      const s = sim.safety();
      return {
        ok: true,
        ...base([...ruleRefs(), REF_PCA, KR.row3.id + ' (XMEAS(21) limits unspecified)']),
        rules: s.rules,
        pca: s.pca ? { ...s.pca, note: 'Anomaly score only. The monitor has no fault classifier and never names a fault; contributors are variables, not causes.' } : null,
        loop: s.loop,
        interpretation: {
          ruleStates: 'NORMAL < ATTENTION (demo band, last 25 % of headroom) < ALARM (above approved normal upper) < TRIP (at/above approved shutdown).',
          whenTrip: 'Recommend no adjustments and escalate to a human. The gate rejects every proposal while a TRIP is active.',
        },
      };
    },

    get_topology_impact(args: { node_id: string; max_hops?: number }): ToolResult {
      const key = resolveElement(args?.node_id);
      if (!key) return err('Unknown node or edge id "' + String(args?.node_id) + '". Use ids from get_plant_overview (for example "reactor" or "reactor_cooling_water_in").', [REF_TOPO]);
      const hops = Math.max(1, Math.min(MAX_HOPS, Math.floor(Number(args.max_hops ?? 3)) || 3));
      return { ok: true, ...base([REF_TOPO, REF_DV, KR.topo.id]), impact: impact(key, hops) };
    },

    get_engineering_context(args: { node_id: string }): ToolResult {
      const c = getEngineeringContext(args?.node_id);
      if (!c) return err('Unknown node or edge id "' + String(args?.node_id) + '".', [REF_TOPO]);
      const refs = [REF_TOPO, ...new Set(c.knowledge.flatMap((k) => k.refs.map((r) => r.id + ' · ' + r.review))), ...c.rules.map((r) => r.id)];
      return { ok: true, ...base(refs), context: c };
    },

    simulate_adjustment(args: { xmv: string; target: number; minutes?: number }): ToolResult {
      const xmv = String(args?.xmv ?? '').trim();
      if (!XMV_IDS.includes(xmv)) return err('Unknown XMV "' + xmv + '". Valid: XMV(1)..XMV(12).');
      if (!MODELLED_XMVS.includes(xmv)) return err(xmv + ' is not simulated by the lumped model, so its effect cannot be predicted. Adjustable: ' + MODELLED_XMVS.join(', ') + '.');
      const target = Number(args?.target);
      if (!Number.isFinite(target) || target < GATE_PARAMS.xmvMin || target > GATE_PARAMS.xmvMax) return err('target must be a number in ' + GATE_PARAMS.xmvMin + '..' + GATE_PARAMS.xmvMax + ' %.');
      const minutes = Math.max(1, Math.min(MAX_SIM_MINUTES, Number(args?.minutes ?? GATE_PARAMS.horizonMin) || GATE_PARAMS.horizonMin));
      const withChange = simulateAhead(sim, { xmv, target }, minutes);
      const noChange = simulateAhead(sim, null, minutes);
      return {
        ok: true,
        ...base([...ruleRefs(), REF_PCA, KR.ctrl.id]),
        branchOnly: true,
        note: 'Branch copy only: the live plant was not changed. This is not a gate verdict; propose_adjustment runs the gate.',
        input: { xmv, target, minutes, current: round(sim.plant.VAL[xmv]) },
        withChange,
        noChange,
        pcaLimits: sim.pcaModel ? { t2: sim.pcaModel.t2Limit, spe: sim.pcaModel.speLimit } : null,
      };
    },

    propose_adjustment(args: { xmv: string; target: number; rationale: string }, source = 'mcp'): ToolResult {
      const r = evaluateAdjustment(sim, { xmv: args?.xmv, target: args?.target, rationale: args?.rationale }, { apply: true, source });
      return {
        ok: true,
        ...base([...ruleRefs(), REF_PCA, REF_GATE]),
        snapshot: r.snapshot,
        verdict: r.verdict,
        applied: r.applied,
        reasons: r.reasons,
        checks: r.checks,
        current: r.current,
        simulation: r.simulation,
        gateLogSeq: r.logSeq,
        params: r.params,
        note: r.applied
          ? 'Applied: XMV(10) loop is now MANUAL at the target. Only a human can return it to AUTO.'
          : 'Not applied. The gate decides; do not retry the same proposal to get around it.',
      };
    },

    get_gate_log(args: { limit?: number } = {}): ToolResult {
      const limit = Math.max(1, Math.min(50, Math.floor(Number(args?.limit ?? 20)) || 20));
      const log = (sim.gateLog as GateLogEntry[]).slice(-limit).reverse();
      return { ok: true, ...base([REF_GATE]), total: sim.gateSeq, entries: log };
    },
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
