/**
 * Deterministic adjustment gate. The model (an LLM or a person) only proposes;
 * this function decides. It returns ACCEPT or REJECT with machine-readable reasons
 * and appends every evaluation to the gate log.
 *
 * Checks (all evaluated, so a REJECT lists every failing reason):
 *   XMV_UNKNOWN         the id is not a TEP manipulated variable
 *   XMV_NOT_MODELLED    a TEP XMV the lumped model does not simulate (only XMV(10) is)
 *   TARGET_INVALID      target is not a finite number
 *   TARGET_OUT_OF_RANGE target outside 0..100 %
 *   RATIONALE_MISSING   empty rationale
 *   TRIP_ACTIVE         any rule is in TRIP: no adjustments, escalate to a human
 *   STEP_TOO_LARGE      |target - current| > maxStepPct
 *   RATE_LIMIT          applied change on this XMV within the rate window would exceed the budget
 *   SIM_RULE_ALARM      simulate-before-act: some rule reaches ALARM within the horizon
 *   SIM_RULE_TRIP       simulate-before-act: some rule reaches TRIP within the horizon
 *                       (if the no-change branch reaches ALARM/TRIP anyway, the change is judged
 *                       relative to it: rejected only if it worsens the state or any ruled peak)
 *   SIM_HEADROOM_LOSS   simulate-before-act: versus no change, the peak of a ruled signal rises
 *                       by more than 5 % of its nominal headroom to the normal upper limit
 *   PCA_SPE_WORSENS     simulate-before-act: mean SPE over the horizon is worse than the
 *                       no-change branch by more than the margin, and above the SPE limit
 *
 * The branches are copies; the main simulation is never mutated by an evaluation.
 */
import { MINUTES_PER_STEP } from './plant.ts';
import { scorePca, windowMean } from './pca.ts';
import { evaluateRules, RULED_SIGNALS, RULES, STATE_ORDER, type RuleState } from './rules.ts';
import { MODELLED_XMVS, SIG, XMV_IDS } from './signals.ts';
import { GATE_LOG_CAP, type Simulation, type Snapshot } from './simulation.ts';

export const GATE_PARAMS = {
  xmvMin: 0,
  xmvMax: 100,
  /** max |target - current| per action, percentage points of valve range */
  maxStepPct: 10,
  /** rate limit: total applied change per XMV inside this sliding window... */
  rateWindowMin: 10,
  /** ...may not exceed this many percentage points (including the proposed step) */
  maxChangeInWindowPct: 15,
  /** simulate-before-act horizon, simulated minutes */
  horizonMin: 30,
  /** REJECT if mean SPE(with change) - mean SPE(no change) exceeds this fraction of the SPE limit */
  speMarginOfLimit: 1.0,
  /**
   * REJECT if, versus leaving the plant alone, the change raises the simulated peak of a
   * ruled signal by more than this fraction of its nominal headroom (nominal value to the
   * approved normal upper limit). Demo convention derived from the approved limits.
   */
  maxHeadroomLossFraction: 0.05,
  rationaleMaxLen: 500,
} as const;

export type Verdict = 'ACCEPT' | 'REJECT';

export interface GateReason { code: string; message: string; detail?: Record<string, unknown> }

export interface Proposal { xmv: string; target: number; rationale: string }

export interface BranchSummary {
  horizonMin: number;
  steps: number;
  worstRuleState: RuleState;
  worstRule: { signal: string | null; ruleId: string | null; atMin: number | null };
  peak: Record<string, number>;
  end: Record<string, number>;
  meanSpe: number | null;
  maxSpe: number | null;
  meanT2: number | null;
  firstPcaExceedMin: number | null;
  trajectory: { min: number; 'XMEAS(9)': number; 'XMEAS(7)': number; 'XMEAS(21)': number; 'XMV(10)': number; spe: number | null }[];
}

export interface GateResult {
  verdict: Verdict;
  reasons: GateReason[];
  checks: { code: string; pass: boolean | null }[];
  snapshot: Snapshot;
  input: Proposal;
  current: number | null;
  simulation: { withChange: BranchSummary; noChange: BranchSummary } | null;
  params: typeof GATE_PARAMS;
  applied: boolean;
  logSeq: number;
}

export interface GateLogEntry {
  seq: number;
  ts: string;
  snapshot: Snapshot;
  source: string;
  mode: 'dry-run' | 'apply';
  input: Proposal;
  verdict: Verdict;
  reasons: { code: string; message: string }[];
  applied: boolean;
}

const TRAJ_POINTS = 12;

/** Run a branch copy `minutes` ahead, optionally with an XMV change, and summarise it. */
export function simulateAhead(sim: Simulation, change: { xmv: string; target: number } | null, minutes: number): BranchSummary {
  const b = sim.branch();
  if (change) b.applyAdjustment(change.xmv, change.target, 'branch');
  const steps = Math.max(1, Math.round(minutes / MINUTES_PER_STEP));
  const watch = ['XMEAS(9)', 'XMEAS(7)', 'XMEAS(21)', 'XMV(10)'] as const;
  const peak: Record<string, number> = {};
  watch.forEach((id) => { peak[id] = -Infinity; });
  let worst: RuleState = 'NORMAL';
  let worstRule: BranchSummary['worstRule'] = { signal: null, ruleId: null, atMin: null };
  let speSum = 0;
  let t2Sum = 0;
  let nP = 0;
  let maxSpe = -Infinity;
  let firstExceed: number | null = null;
  const traj: BranchSummary['trajectory'] = [];
  const every = Math.max(1, Math.ceil(steps / TRAJ_POINTS));
  for (let i = 1; i <= steps; i++) {
    b.step();
    const v = b.plant.VAL;
    watch.forEach((id) => { if (v[id] > peak[id]) peak[id] = v[id]; });
    const r = evaluateRules(v);
    if (STATE_ORDER[r.worst.state] > STATE_ORDER[worst]) {
      worst = r.worst.state;
      worstRule = { signal: r.worst.signal, ruleId: r.worst.ruleId, atMin: +(i * MINUTES_PER_STEP).toFixed(1) };
    }
    let spe: number | null = null;
    if (b.pcaModel) {
      const x = windowMean(b.pcaRows, b.pcaModel.window);
      if (x) {
        const s = scorePca(b.pcaModel, x);
        spe = s.spe;
        speSum += s.spe; t2Sum += s.t2; nP++;
        if (s.spe > maxSpe) maxSpe = s.spe;
        if (firstExceed === null && s.exceeded.any) firstExceed = +(i * MINUTES_PER_STEP).toFixed(1);
      }
    }
    if (i % every === 0 || i === steps) {
      traj.push({ min: +(i * MINUTES_PER_STEP).toFixed(1), 'XMEAS(9)': +v['XMEAS(9)'].toFixed(3), 'XMEAS(7)': +v['XMEAS(7)'].toFixed(1), 'XMEAS(21)': +v['XMEAS(21)'].toFixed(3), 'XMV(10)': +v['XMV(10)'].toFixed(3), spe });
    }
  }
  const end: Record<string, number> = {};
  watch.forEach((id) => { end[id] = +b.plant.VAL[id].toFixed(3); peak[id] = +peak[id].toFixed(3); });
  return {
    horizonMin: +(steps * MINUTES_PER_STEP).toFixed(1),
    steps,
    worstRuleState: worst,
    worstRule,
    peak,
    end,
    meanSpe: nP ? +(speSum / nP).toFixed(3) : null,
    maxSpe: nP ? +maxSpe.toFixed(3) : null,
    meanT2: nP ? +(t2Sum / nP).toFixed(3) : null,
    firstPcaExceedMin: firstExceed,
    trajectory: traj,
  };
}

function clip(s: unknown, n: number): string {
  return typeof s === 'string' ? s.slice(0, n) : '';
}

/**
 * Evaluate a proposed adjustment. With opts.apply, an ACCEPT is applied to the
 * main simulation; a REJECT never changes anything except the gate log.
 */
export function evaluateAdjustment(
  sim: Simulation,
  proposal: Proposal,
  opts: { apply?: boolean; source?: string } = {},
): GateResult {
  const P = GATE_PARAMS;
  const input: Proposal = {
    xmv: clip(proposal?.xmv, 32).trim(),
    target: typeof proposal?.target === 'number' ? proposal.target : Number(proposal?.target),
    rationale: clip(proposal?.rationale, P.rationaleMaxLen).trim(),
  };
  const snapshot = sim.snapshot();
  const reasons: GateReason[] = [];
  const checks: { code: string; pass: boolean | null }[] = [];
  const check = (code: string, pass: boolean | null, message?: string, detail?: Record<string, unknown>) => {
    checks.push({ code, pass });
    if (pass === false) reasons.push({ code, message: message || code, detail });
  };

  const known = XMV_IDS.includes(input.xmv);
  check('XMV_UNKNOWN', known, 'Unknown manipulated variable "' + input.xmv + '". Valid ids are XMV(1)..XMV(12).', { allowed: XMV_IDS.slice() });
  const modelled = MODELLED_XMVS.includes(input.xmv);
  check('XMV_NOT_MODELLED', known ? modelled : null,
    input.xmv + ' exists in TEP but the lumped model does not simulate it, so the effect of a change cannot be checked.',
    { modelled: MODELLED_XMVS.slice() });
  const finite = Number.isFinite(input.target);
  check('TARGET_INVALID', finite, 'Target must be a finite number in percent.');
  check('TARGET_OUT_OF_RANGE', finite ? input.target >= P.xmvMin && input.target <= P.xmvMax : null,
    'Target ' + input.target + ' % is outside the XMV range ' + P.xmvMin + '..' + P.xmvMax + ' %.', { min: P.xmvMin, max: P.xmvMax });
  check('RATIONALE_MISSING', input.rationale.length > 0, 'A rationale is required for every proposal.');

  const safety = sim.safety();
  const trip = safety.rules.worst.state === 'TRIP';
  check('TRIP_ACTIVE', !trip, 'A TRIP rule is active (' + safety.rules.worst.ruleId + '). No adjustments; escalate to a human.', { ruleId: safety.rules.worst.ruleId });

  const current = known ? sim.plant.VAL[input.xmv] : null;
  let simulation: GateResult['simulation'] = null;
  if (modelled && finite && current !== null) {
    const step = Math.abs(input.target - current);
    check('STEP_TOO_LARGE', step <= P.maxStepPct + 1e-9,
      'Step of ' + step.toFixed(2) + ' %-points exceeds the maximum ' + P.maxStepPct + ' per action.', { step: +step.toFixed(3), max: P.maxStepPct, current: +current.toFixed(3) });
    const since = sim.t - P.rateWindowMin / 60;
    const used = sim.changes.filter((c) => c.xmv === input.xmv && c.t > since + 1e-9).reduce((a, c) => a + Math.abs(c.to - c.from), 0);
    check('RATE_LIMIT', used + step <= P.maxChangeInWindowPct + 1e-9,
      'Applied change in the last ' + P.rateWindowMin + ' simulated min (' + used.toFixed(2) + ') plus this step (' + step.toFixed(2) + ') exceeds ' + P.maxChangeInWindowPct + ' %-points.',
      { usedInWindow: +used.toFixed(3), step: +step.toFixed(3), budget: P.maxChangeInWindowPct, windowMin: P.rateWindowMin });
  } else {
    check('STEP_TOO_LARGE', null);
    check('RATE_LIMIT', null);
  }

  const staticOk = reasons.length === 0;
  if (staticOk) {
    const withChange = simulateAhead(sim, { xmv: input.xmv, target: input.target }, P.horizonMin);
    const noChange = simulateAhead(sim, null, P.horizonMin);
    simulation = { withChange, noChange };
    const ws = withChange.worstRuleState;
    const ns = noChange.worstRuleState;
    // If the plant reaches ALARM/TRIP anyway without the change, judge the change relative to
    // doing nothing: it must not raise the worst state and must not raise any ruled peak.
    // Otherwise a corrective move could never be accepted once an ALARM is already coming.
    const unavoidable = STATE_ORDER[ns] >= STATE_ORDER.ALARM;
    const peakWorse = RULED_SIGNALS.some((s) => withChange.peak[s] > noChange.peak[s] + 1e-9);
    const relFail = STATE_ORDER[ws] > STATE_ORDER[ns] || peakWorse;
    const simDetail = { ...withChange.worstRule, noChangeWorstState: ns, judgedRelativeToNoChange: unavoidable };
    check('SIM_RULE_TRIP', !(ws === 'TRIP' && (!unavoidable || relFail)),
      'Simulated ' + P.horizonMin + ' min ahead, ' + withChange.worstRule.ruleId + ' reaches TRIP at +' + withChange.worstRule.atMin + ' min' + (unavoidable ? ' and the change does not improve on no change (' + ns + ').' : '.'), simDetail);
    check('SIM_RULE_ALARM', !(ws === 'ALARM' && (!unavoidable || relFail)),
      'Simulated ' + P.horizonMin + ' min ahead, ' + withChange.worstRule.ruleId + ' reaches ALARM at +' + withChange.worstRule.atMin + ' min' + (unavoidable ? ' and the change does not improve on no change (' + ns + ').' : '.'), simDetail);
    const losses = RULES.filter((r) => r.kind === 'NORMAL_UPPER').map((r) => {
      const allowed = P.maxHeadroomLossFraction * (r.value - SIG[r.signal][2]);
      const loss = withChange.peak[r.signal] - noChange.peak[r.signal];
      return { signal: r.signal, ruleId: r.id, loss: +loss.toFixed(3), allowed: +allowed.toFixed(3) };
    }).filter((x) => x.loss > x.allowed);
    check('SIM_HEADROOM_LOSS', losses.length === 0,
      'Versus no change, the simulated peak of ' + losses.map((x) => x.signal + ' rises by ' + x.loss + ' (allowed ' + x.allowed + ')').join(', ') + ', eating into the headroom to the normal upper limit.',
      { exceeded: losses });
    if (sim.pcaModel && withChange.meanSpe !== null && noChange.meanSpe !== null) {
      const margin = P.speMarginOfLimit * sim.pcaModel.speLimit;
      const worse = withChange.meanSpe - noChange.meanSpe;
      check('PCA_SPE_WORSENS', !(worse > margin && withChange.meanSpe > sim.pcaModel.speLimit),
        'Mean SPE over the horizon would rise from ' + noChange.meanSpe.toFixed(2) + ' (no change) to ' + withChange.meanSpe.toFixed(2) + ', more than the margin ' + margin.toFixed(2) + '.',
        { meanSpeWith: withChange.meanSpe, meanSpeWithout: noChange.meanSpe, margin: +margin.toFixed(3), speLimit: sim.pcaModel.speLimit });
    } else {
      check('PCA_SPE_WORSENS', null);
    }
  } else {
    check('SIM_RULE_TRIP', null);
    check('SIM_RULE_ALARM', null);
    check('SIM_HEADROOM_LOSS', null);
    check('PCA_SPE_WORSENS', null);
  }

  const verdict: Verdict = reasons.length === 0 ? 'ACCEPT' : 'REJECT';
  let applied = false;
  if (verdict === 'ACCEPT' && opts.apply) {
    sim.applyAdjustment(input.xmv, input.target, opts.source || 'unknown');
    applied = true;
  }
  const entry: GateLogEntry = {
    seq: ++sim.gateSeq,
    ts: new Date(sim.now()).toISOString(),
    snapshot,
    source: opts.source || 'unknown',
    mode: opts.apply ? 'apply' : 'dry-run',
    input,
    verdict,
    reasons: reasons.map((r) => ({ code: r.code, message: r.message })),
    applied,
  };
  sim.gateLog.push(entry);
  while (sim.gateLog.length > GATE_LOG_CAP) sim.gateLog.shift();
  return {
    verdict,
    reasons,
    checks,
    snapshot,
    input,
    current: current === null || current === undefined ? null : +current.toFixed(3),
    simulation,
    params: GATE_PARAMS,
    applied,
    logSeq: entry.seq,
  };
}
