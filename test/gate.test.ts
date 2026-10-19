import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSimulation, evaluateAdjustment, GATE_LOG_CAP, GATE_PARAMS, type Simulation } from '../src/engine/index.ts';

const fixedNow = () => Date.UTC(2026, 9, 19, 12, 0, 0);
const mk = (seed = 42) => createSimulation({ seed, now: fixedNow });
const cur = (sim: Simulation) => sim.plant.VAL['XMV(10)'];
const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);
const propose = (sim: Simulation, target: number, extra: Partial<{ xmv: string; rationale: string }> = {}, apply = false) =>
  evaluateAdjustment(sim, { xmv: 'XMV(10)', target, rationale: 'test', ...extra } as never, { apply, source: 'test' });

function stateKey(sim: Simulation): string {
  return JSON.stringify({ p: sim.plant, rows: sim.pcaRows, ch: sim.changes, ev: sim.events, h: [sim.hist.t.length, sim.hist.K.at(-1)] });
}

test('gate parameters are the documented ones', () => {
  assert.equal(GATE_PARAMS.maxStepPct, 10);
  assert.equal(GATE_PARAMS.maxChangeInWindowPct, 15);
  assert.equal(GATE_PARAMS.rateWindowMin, 10);
  assert.equal(GATE_PARAMS.horizonMin, 30);
});

test('REJECT XMV_UNKNOWN and XMV_NOT_MODELLED', () => {
  const sim = mk();
  assert.deepEqual(codes(propose(sim, 50, { xmv: 'XMV(13)' })), ['XMV_UNKNOWN']);
  assert.deepEqual(codes(propose(sim, 50, { xmv: 'XMEAS(9)' })), ['XMV_UNKNOWN']);
  const r = propose(sim, 50, { xmv: 'XMV(3)' });
  assert.equal(r.verdict, 'REJECT');
  assert.deepEqual(codes(r), ['XMV_NOT_MODELLED']);
});

test('REJECT TARGET_INVALID, TARGET_OUT_OF_RANGE, RATIONALE_MISSING', () => {
  const sim = mk();
  assert.ok(codes(propose(sim, Number.NaN)).includes('TARGET_INVALID'));
  assert.ok(codes(propose(sim, 'abc' as never)).includes('TARGET_INVALID'));
  assert.ok(codes(propose(sim, 101)).includes('TARGET_OUT_OF_RANGE'));
  assert.ok(codes(propose(sim, -1)).includes('TARGET_OUT_OF_RANGE'));
  assert.deepEqual(codes(propose(sim, cur(sim) + 1, { rationale: '   ' })), ['RATIONALE_MISSING']);
});

test('REJECT STEP_TOO_LARGE for a +30 % step', () => {
  const sim = mk();
  const r = propose(sim, cur(sim) + 30);
  assert.equal(r.verdict, 'REJECT');
  assert.deepEqual(codes(r), ['STEP_TOO_LARGE', 'RATE_LIMIT'], 'every failing check is listed');
  assert.equal(r.simulation, null, 'no simulation when a static check fails');
});

test('REJECT RATE_LIMIT when applied change in the window plus this step exceeds the budget', () => {
  const sim = mk();
  sim.applyAdjustment('XMV(10)', cur(sim) + 8, 'setup');
  sim.step(2);
  const r = propose(sim, cur(sim) + 8);
  assert.ok(codes(r).includes('RATE_LIMIT'), JSON.stringify(codes(r)));
  sim.step(Math.ceil(GATE_PARAMS.rateWindowMin / 0.6) + 1);
  assert.ok(!codes(propose(sim, cur(sim) + 8)).includes('RATE_LIMIT'), 'window slides');
});

test('REJECT TRIP_ACTIVE', () => {
  const sim = mk();
  sim.plant.M.Tr = 180;
  sim.step();
  assert.equal(sim.safety().rules.worst.state, 'TRIP');
  const r = propose(sim, cur(sim) + 1);
  assert.ok(codes(r).includes('TRIP_ACTIVE'));
  assert.equal(r.verdict, 'REJECT');
});

test('REJECT SIM_RULE_ALARM and SIM_RULE_TRIP from simulate-before-act', () => {
  const sim = mk();
  sim.applyAdjustment('XMV(10)', 31.1, 'setup');
  sim.step(300);
  const a = propose(sim, 21.1);
  assert.ok(codes(a).includes('SIM_RULE_ALARM'), JSON.stringify(codes(a)));
  assert.equal(a.simulation!.withChange.worstRuleState, 'ALARM');

  const t = mk();
  t.applyAdjustment('XMV(10)', 21.1, 'setup');
  let guard = 0;
  while (t.safety().rules.worst.state !== 'ALARM' && guard++ < 400) t.step();
  assert.equal(t.safety().rules.worst.state, 'ALARM');
  const r = propose(t, 11.1);
  assert.ok(codes(r).includes('SIM_RULE_TRIP'), JSON.stringify(codes(r)));
});

test('corrective move is not blocked by an ALARM that happens anyway without the change', () => {
  const t = mk();
  t.applyAdjustment('XMV(10)', 21.1, 'setup');
  let guard = 0;
  while (t.safety().rules.worst.state !== 'ALARM' && guard++ < 400) t.step();
  assert.equal(t.safety().rules.worst.state, 'ALARM');
  const r = propose(t, 31.1);
  const sim = r.simulation!;
  assert.ok(['ALARM', 'TRIP'].includes(sim.noChange.worstRuleState), sim.noChange.worstRuleState);
  assert.ok(!codes(r).includes('SIM_RULE_ALARM'), JSON.stringify(codes(r)));
  assert.ok(!codes(r).includes('SIM_RULE_TRIP'), JSON.stringify(codes(r)));
  assert.ok(sim.withChange.peak['XMEAS(9)'] <= sim.noChange.peak['XMEAS(9)']);
});

test('REJECT SIM_HEADROOM_LOSS and PCA_SPE_WORSENS', () => {
  const a = propose(mk(), cur(mk()) - 3);
  assert.deepEqual(codes(a), ['SIM_HEADROOM_LOSS']);
  const sim = mk();
  const b = propose(sim, cur(sim) + 10);
  assert.deepEqual(codes(b), ['PCA_SPE_WORSENS']);
});

test('ACCEPT path: dry-run does not apply; apply puts the loop in MANUAL at the target', () => {
  const sim = mk();
  const target = +(cur(sim) + 2).toFixed(1);
  const dry = propose(sim, target);
  assert.equal(dry.verdict, 'ACCEPT');
  assert.equal(dry.applied, false);
  assert.equal(sim.plant.mode, 'AUTO');
  assert.ok(dry.checks.every((c) => c.pass !== false));
  const r = propose(sim, target, {}, true);
  assert.equal(r.verdict, 'ACCEPT');
  assert.equal(r.applied, true);
  assert.equal(sim.plant.mode, 'MANUAL');
  assert.equal(sim.plant.uMan, target);
  sim.step();
  assert.equal(sim.plant.VAL['XMV(10)'], target);
  assert.equal(sim.events.at(-1)!.type, 'ADJUSTMENT_APPLIED');
  sim.restoreAuto('human');
  assert.equal(sim.plant.mode, 'AUTO');
});

test('branch isolation: evaluation never mutates the main state (dry-run, REJECT, simulate)', () => {
  const sim = mk();
  sim.injectIdv4(5);
  sim.step(20);
  const before = stateKey(sim);
  propose(sim, cur(sim) + 2);
  propose(sim, cur(sim) - 5);
  propose(sim, cur(sim) + 30, {}, true);
  propose(sim, cur(sim) + 10, {}, true);
  assert.equal(stateKey(sim), before);
  // the branch replays the same noise: stepping the main sim matches a fresh branch
  const b = sim.branch();
  sim.step(10); b.step(10);
  assert.deepEqual(b.plant.VAL, sim.plant.VAL);
});

test('every evaluation is logged with timestamp, snapshot, inputs, verdict, reasons; log is capped', () => {
  const sim = mk();
  const r = propose(sim, cur(sim) + 30);
  const e = sim.gateLog.at(-1) as Record<string, unknown>;
  assert.equal(e.seq, r.logSeq);
  assert.equal(e.ts, '2026-10-19T12:00:00.000Z');
  assert.deepEqual(e.snapshot, r.snapshot);
  assert.match((e.snapshot as { id: string }).id, /^snap@T\d+\.\d{2}h\/K\d+$/);
  assert.equal(e.verdict, 'REJECT');
  assert.equal((e.input as { xmv: string }).xmv, 'XMV(10)');
  assert.deepEqual((e.reasons as { code: string }[]).map((x) => x.code), ['STEP_TOO_LARGE', 'RATE_LIMIT']);
  for (let i = 0; i < GATE_LOG_CAP + 20; i++) propose(sim, 200);
  assert.equal(sim.gateLog.length, GATE_LOG_CAP);
  assert.equal(sim.gateSeq, GATE_LOG_CAP + 21);
});

test('long rationale is clipped, bounded buffers hold', () => {
  const sim = mk();
  const r = propose(sim, cur(sim) + 1, { rationale: 'x'.repeat(5000) });
  assert.equal(r.input.rationale.length, GATE_PARAMS.rationaleMaxLen);
  sim.step(1000);
  assert.equal(sim.hist.t.length, 480);
  for (let i = 0; i < 200; i++) sim.injectIdv4(i % 2 ? 5 : 0);
  assert.equal(sim.events.length, 100);
});
