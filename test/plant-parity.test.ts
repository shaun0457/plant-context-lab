// The engine's plant model must behave exactly like the model that used to live
// in index.html. This test carries a verbatim copy of the original simStep()
// (only Math.random is replaced by the same seeded source) and compares them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlantState, setDisturbance, stepPlant } from '../src/engine/plant.ts';
import { createRng, gauss as rngGauss } from '../src/engine/rng.ts';
import { SIG } from '../src/engine/signals.ts';

function originalModel(seed: number) {
  const r = createRng(seed);
  const gauss = () => rngGauss(r);
  const STEP_H = 0.01, SUB = 10;
  const M: Record<string, number> = { Tr: 120.40, To: 94.599, Tin0: 35, UA: 1, Cc: 0.02, Cr: 0.25, u0: 41.106, Kc: 6, Ti: 0.25, I: 0, u: 41.106, d: 0, df: 0, Pl: 0, Sl: 0, qn: 0, mn: 0, pn: 0 };
  M.Q0 = M.UA * (M.Tr - M.To); M.kF = M.Q0 / (M.To - M.Tin0) / M.u0;
  const SIM = { t: 0, K: 0 };
  const VAL: Record<string, number> = {}, OU: Record<string, number> = {};
  Object.keys(SIG).forEach(function (id) { OU[id] = 0; VAL[id] = SIG[id][2]; });
  /* ---- verbatim from the original page (minus chart buffer pushes) ---- */
  function simStep() {
    var dt = STEP_H / SUB;
    M.mn = gauss() * 0.012;
    for (var i = 0; i < SUB; i++) {
      M.df += (M.d - M.df) * dt / 0.01;
      M.qn += (-M.qn / 0.4) * dt + 0.0025 * Math.sqrt(dt) * gauss();
      var Tin = M.Tin0 + M.df, Q = M.Q0 * (1 + M.qn);
      var e = (M.Tr + M.mn) - 120.40; M.I += e * dt;
      M.u = Math.max(0, Math.min(100, M.u0 + M.Kc * e + M.Kc / M.Ti * M.I));
      var F = M.kF * M.u;
      var dTo = (F * (Tin - M.To) + M.UA * (M.Tr - M.To)) / M.Cc, dTr = (Q - M.UA * (M.Tr - M.To)) / M.Cr;
      M.To += dTo * dt; M.Tr += dTr * dt;
      M.Pl += ((M.Tr - 120.40) - M.Pl) * dt / 0.08; M.Sl += ((M.Tr - 120.40) - M.Sl) * dt / 0.25;
    }
    M.pn += (-M.pn / 0.15) * STEP_H + 0.9 * Math.sqrt(STEP_H) * gauss();
    SIM.t += STEP_H; SIM.K++;
    Object.keys(SIG).forEach(function (id) { OU[id] += (-OU[id] / 0.3) * STEP_H + 0.0012 * Math.sqrt(STEP_H) * gauss(); VAL[id] = SIG[id][2] * (1 + OU[id] + 0.0006 * gauss()); });
    VAL['XMEAS(9)'] = M.Tr + M.mn;
    VAL['XMEAS(21)'] = M.To + gauss() * 0.03;
    VAL['XMV(10)'] = M.u;
    VAL['XMEAS(7)'] = 2705.0 + 7 * M.Pl + M.pn + gauss() * 0.35;
    VAL['XMEAS(11)'] = 80.109 + 0.6 * M.Sl + gauss() * 0.02;
    VAL['XMEAS(13)'] = 2633.7 + 0.95 * (VAL['XMEAS(7)'] - 2705.0) + gauss() * 0.3;
  }
  return { M, SIM, VAL, simStep };
}

test('engine plant model is identical to the original page model (incl. IDV(4) inject/remove)', () => {
  for (const seed of [1, 42, 20261019]) {
    const o = originalModel(seed);
    const s = createPlantState(seed);
    for (let k = 0; k < 1500; k++) {
      if (k === 500) { o.M.d = 5; setDisturbance(s, 5); }
      if (k === 900) { o.M.d = 10; setDisturbance(s, 10); }
      if (k === 1200) { o.M.d = 0; setDisturbance(s, 0); }
      o.simStep();
      stepPlant(s);
    }
    assert.equal(s.K, o.SIM.K);
    assert.equal(s.t, o.SIM.t);
    for (const id of Object.keys(SIG)) assert.equal(s.VAL[id], o.VAL[id], 'signal ' + id + ' seed ' + seed);
    for (const k of ['Tr', 'To', 'u', 'I', 'Pl', 'Sl', 'qn', 'pn', 'df']) assert.equal((s.M as unknown as Record<string, number>)[k], o.M[k], 'state ' + k);
  }
});
