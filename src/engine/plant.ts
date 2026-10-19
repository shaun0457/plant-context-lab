/**
 * Illustrative lumped model of the TEP reactor-cooling subsystem.
 * NOT output from the TEP simulator.
 *
 * Moved out of the original page with identical equations, constants and noise
 * call order: reactor heat balance, cooling-water outlet temperature, a PI loop
 * from XMEAS(9) to XMV(10), noise and pressure lag. Two additions, both inert in
 * the original operating mode:
 *   - noise comes from an injected seeded RNG instead of Math.random();
 *   - the XMV(10) loop can be put in MANUAL (operator output) and returned to
 *     AUTO bumplessly. In AUTO the arithmetic is unchanged.
 */
import { createRng, gauss, type RngState } from './rng.ts';
import { SIG, SIGNAL_IDS } from './signals.ts';

export const STEP_H = 0.01; // one sample = 0.01 h = 0.6 min
export const SUB = 10;
export const TR_SETPOINT = 120.40;
export const MINUTES_PER_STEP = STEP_H * 60;

export interface ModelVars {
  Tr: number; To: number; Tin0: number; UA: number; Cc: number; Cr: number;
  u0: number; Kc: number; Ti: number; I: number; u: number;
  d: number; df: number; Pl: number; Sl: number; qn: number; mn: number; pn: number;
  Q0: number; kF: number;
}

export type LoopMode = 'AUTO' | 'MANUAL';

export interface PlantState {
  M: ModelVars;
  t: number;
  K: number;
  VAL: Record<string, number>;
  OU: Record<string, number>;
  rng: RngState;
  mode: LoopMode;
  uMan: number;
}

export function createPlantState(seed: number): PlantState {
  const M: ModelVars = { Tr: 120.40, To: 94.599, Tin0: 35, UA: 1, Cc: 0.02, Cr: 0.25, u0: 41.106, Kc: 6, Ti: 0.25, I: 0, u: 41.106, d: 0, df: 0, Pl: 0, Sl: 0, qn: 0, mn: 0, pn: 0, Q0: 0, kF: 0 };
  M.Q0 = M.UA * (M.Tr - M.To);
  M.kF = M.Q0 / (M.To - M.Tin0) / M.u0;
  const VAL: Record<string, number> = {};
  const OU: Record<string, number> = {};
  SIGNAL_IDS.forEach((id) => { OU[id] = 0; VAL[id] = SIG[id][2]; });
  return { M, t: 0, K: 0, VAL, OU, rng: createRng(seed), mode: 'AUTO', uMan: M.u0 };
}

export function clonePlantState(s: PlantState): PlantState {
  return {
    M: { ...s.M },
    t: s.t,
    K: s.K,
    VAL: { ...s.VAL },
    OU: { ...s.OU },
    rng: { s: s.rng.s },
    mode: s.mode,
    uMan: s.uMan,
  };
}

/** Advance one sample (STEP_H). Mirrors the original simStep() model section. */
export function stepPlant(s: PlantState): void {
  const M = s.M;
  const r = s.rng;
  const dt = STEP_H / SUB;
  M.mn = gauss(r) * 0.012;
  for (let i = 0; i < SUB; i++) {
    M.df += (M.d - M.df) * dt / 0.01;
    M.qn += (-M.qn / 0.4) * dt + 0.0025 * Math.sqrt(dt) * gauss(r);
    const Tin = M.Tin0 + M.df;
    const Q = M.Q0 * (1 + M.qn);
    const e = (M.Tr + M.mn) - 120.40;
    if (s.mode === 'AUTO') {
      M.I += e * dt;
      M.u = Math.max(0, Math.min(100, M.u0 + M.Kc * e + M.Kc / M.Ti * M.I));
    } else {
      M.u = Math.max(0, Math.min(100, s.uMan));
    }
    const F = M.kF * M.u;
    const dTo = (F * (Tin - M.To) + M.UA * (M.Tr - M.To)) / M.Cc;
    const dTr = (Q - M.UA * (M.Tr - M.To)) / M.Cr;
    M.To += dTo * dt;
    M.Tr += dTr * dt;
    M.Pl += ((M.Tr - 120.40) - M.Pl) * dt / 0.08;
    M.Sl += ((M.Tr - 120.40) - M.Sl) * dt / 0.25;
  }
  M.pn += (-M.pn / 0.15) * STEP_H + 0.9 * Math.sqrt(STEP_H) * gauss(r);
  s.t += STEP_H;
  s.K++;
  const VAL = s.VAL;
  const OU = s.OU;
  for (let j = 0; j < SIGNAL_IDS.length; j++) {
    const id = SIGNAL_IDS[j];
    OU[id] += (-OU[id] / 0.3) * STEP_H + 0.0012 * Math.sqrt(STEP_H) * gauss(r);
    VAL[id] = SIG[id][2] * (1 + OU[id] + 0.0006 * gauss(r));
  }
  VAL['XMEAS(9)'] = M.Tr + M.mn;
  VAL['XMEAS(21)'] = M.To + gauss(r) * 0.03;
  VAL['XMV(10)'] = M.u;
  VAL['XMEAS(7)'] = 2705.0 + 7 * M.Pl + M.pn + gauss(r) * 0.35;
  VAL['XMEAS(11)'] = 80.109 + 0.6 * M.Sl + gauss(r) * 0.02;
  VAL['XMEAS(13)'] = 2633.7 + 0.95 * (VAL['XMEAS(7)'] - 2705.0) + gauss(r) * 0.3;
}

/** IDV(4): step in reactor cooling-water inlet temperature, degC (0 removes it). */
export function setDisturbance(s: PlantState, mag: number): void {
  s.M.d = mag;
}

/** Operator output for XMV(10): puts the loop in MANUAL at the given output. */
export function setManualOutput(s: PlantState, u: number): void {
  s.mode = 'MANUAL';
  s.uMan = Math.max(0, Math.min(100, u));
}

/**
 * Return the loop to AUTO bumplessly: re-initialise the integral so that the PI
 * output equals the current valve position at the current error.
 */
export function restoreAuto(s: PlantState): void {
  if (s.mode === 'AUTO') return;
  const M = s.M;
  const e = (M.Tr + M.mn) - 120.40;
  M.I = (M.u - M.u0 - M.Kc * e) * M.Ti / M.Kc;
  s.mode = 'AUTO';
}
