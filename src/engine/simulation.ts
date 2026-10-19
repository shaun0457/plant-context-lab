/**
 * Simulation = one plant state + capped history + safety evaluation + logs.
 *
 * Both the static page and the local server hold exactly one of these. A branch
 * (for simulate-before-act) is a copy of the plant state and the PCA window only;
 * it never touches the parent.
 */
import {
  clonePlantState, createPlantState, restoreAuto, setDisturbance, setManualOutput, stepPlant,
  MINUTES_PER_STEP, STEP_H, type LoopMode, type PlantState,
} from './plant.ts';
import { scorePca, windowMean, type PcaModel, type PcaScore } from './pca.ts';
import { evaluateRules, type RulesResult } from './rules.ts';
import { SIG, SIGNAL_IDS, isKnownSignal } from './signals.ts';

export const HISTORY_CAP = 480;
export const EVENT_CAP = 100;
export const CHANGE_CAP = 50;
export const GATE_LOG_CAP = 200;
export const MAX_SIGNAL_IDS = 8;
export const MAX_SIGNAL_POINTS = 60;

export interface Snapshot { id: string; T_h: number; K: number }

export function snapshotOf(t: number, K: number): Snapshot {
  return { id: 'snap@T' + t.toFixed(2) + 'h/K' + K, T_h: +t.toFixed(4), K };
}

export interface SafetyState {
  snapshot: Snapshot;
  rules: RulesResult;
  pca: PcaScore | null;
  loop: { xmv: 'XMV(10)'; mode: LoopMode; output: number };
}

export interface SimEvent {
  seq: number;
  type: 'IDV4_INJECT' | 'IDV4_REMOVE' | 'ADJUSTMENT_APPLIED' | 'LOOP_AUTO';
  snapshot: Snapshot;
  source: string;
  detail: Record<string, unknown>;
}

export interface AppliedChange { K: number; t: number; xmv: string; from: number; to: number }

export interface SimOptions {
  seed?: number;
  warmup?: number;
  historyCap?: number;
  pcaModel?: PcaModel | null;
  /** wall clock in ms, injectable for tests */
  now?: () => number;
}

export interface Sample {
  snapshot: Snapshot;
  t: number;
  K: number;
  values: Record<string, number>;
  mode: LoopMode;
  disturbance: number;
}

export class Simulation {
  plant: PlantState;
  pcaModel: PcaModel | null;
  historyCap: number;
  hist: { t: number[]; K: number[]; v: Record<string, number[]> };
  pcaRows: number[][];
  events: SimEvent[];
  changes: AppliedChange[];
  gateLog: unknown[];
  gateSeq: number;
  eventSeq: number;
  now: () => number;
  private safetyCache: { K: number; mode: LoopMode; s: SafetyState } | null;

  constructor(opt: SimOptions = {}) {
    this.plant = createPlantState(opt.seed ?? 1);
    this.pcaModel = opt.pcaModel ?? null;
    this.historyCap = opt.historyCap ?? HISTORY_CAP;
    this.hist = { t: [], K: [], v: {} };
    SIGNAL_IDS.forEach((id) => { this.hist.v[id] = []; });
    this.pcaRows = [];
    this.events = [];
    this.changes = [];
    this.gateLog = [];
    this.gateSeq = 0;
    this.eventSeq = 0;
    this.now = opt.now ?? (() => Date.now());
    this.safetyCache = null;
    const warm = opt.warmup ?? HISTORY_CAP;
    for (let i = 0; i < warm; i++) this.step();
  }

  /** Advance n samples. */
  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      stepPlant(this.plant);
      this.record();
    }
  }

  private record(): void {
    const s = this.plant;
    if (this.pcaModel) {
      this.pcaRows.push(this.pcaModel.variables.map((id) => s.VAL[id]));
      while (this.pcaRows.length > this.pcaModel.window) this.pcaRows.shift();
    }
    if (this.historyCap <= 0) return;
    const h = this.hist;
    h.t.push(s.t); h.K.push(s.K);
    if (h.t.length > this.historyCap) { h.t.shift(); h.K.shift(); }
    for (let j = 0; j < SIGNAL_IDS.length; j++) {
      const a = h.v[SIGNAL_IDS[j]];
      a.push(s.VAL[SIGNAL_IDS[j]]);
      if (a.length > this.historyCap) a.shift();
    }
  }

  get t(): number { return this.plant.t; }
  get K(): number { return this.plant.K; }

  snapshot(): Snapshot { return snapshotOf(this.plant.t, this.plant.K); }

  values(): Record<string, number> { return { ...this.plant.VAL }; }

  sample(): Sample {
    return { snapshot: this.snapshot(), t: this.plant.t, K: this.plant.K, values: this.values(), mode: this.plant.mode, disturbance: this.plant.M.d };
  }

  pcaScore(): PcaScore | null {
    if (!this.pcaModel) return null;
    const x = windowMean(this.pcaRows, this.pcaModel.window);
    return x ? scorePca(this.pcaModel, x) : null;
  }

  safety(): SafetyState {
    const c = this.safetyCache;
    if (c && c.K === this.plant.K && c.mode === this.plant.mode) return c.s;
    const s: SafetyState = {
      snapshot: this.snapshot(),
      rules: evaluateRules(this.plant.VAL),
      pca: this.pcaScore(),
      loop: { xmv: 'XMV(10)', mode: this.plant.mode, output: +this.plant.M.u.toFixed(3) },
    };
    this.safetyCache = { K: this.plant.K, mode: this.plant.mode, s };
    return s;
  }

  /* ---------------- human-only scenario controls (never exposed as agent tools) ---------------- */

  injectIdv4(mag: number, source = 'human'): void {
    const m = Math.max(0, Math.min(10, Number(mag) || 0));
    setDisturbance(this.plant, m);
    this.pushEvent(m > 0 ? 'IDV4_INJECT' : 'IDV4_REMOVE', source, { magnitude_degC: m });
  }

  removeDisturbance(source = 'human'): void {
    if (!this.plant.M.d) return;
    setDisturbance(this.plant, 0);
    this.pushEvent('IDV4_REMOVE', source, {});
  }

  restoreAuto(source = 'human'): void {
    if (this.plant.mode === 'AUTO') return;
    restoreAuto(this.plant);
    this.safetyCache = null;
    this.pushEvent('LOOP_AUTO', source, { output: +this.plant.M.u.toFixed(3) });
  }

  /** Apply an XMV change. Only the gate calls this, after an ACCEPT verdict. */
  applyAdjustment(xmv: string, target: number, source: string): AppliedChange {
    if (xmv !== 'XMV(10)') throw new Error('not a modelled XMV: ' + xmv);
    const from = this.plant.M.u;
    setManualOutput(this.plant, target);
    this.safetyCache = null;
    const ch: AppliedChange = { K: this.plant.K, t: this.plant.t, xmv, from, to: this.plant.uMan };
    this.changes.push(ch);
    while (this.changes.length > CHANGE_CAP) this.changes.shift();
    this.pushEvent('ADJUSTMENT_APPLIED', source, { xmv, from: +from.toFixed(3), to: ch.to, mode: 'MANUAL' });
    return ch;
  }

  private pushEvent(type: SimEvent['type'], source: string, detail: Record<string, unknown>): void {
    this.events.push({ seq: ++this.eventSeq, type, snapshot: this.snapshot(), source, detail });
    while (this.events.length > EVENT_CAP) this.events.shift();
  }

  /** Copy of plant + PCA window. Logs, history and events are not copied. */
  branch(): Simulation {
    const b = new Simulation({ seed: 1, warmup: 0, historyCap: 0, pcaModel: this.pcaModel, now: this.now });
    b.plant = clonePlantState(this.plant);
    b.pcaRows = this.pcaRows.map((r) => r.slice());
    b.changes = this.changes.map((c) => ({ ...c }));
    return b;
  }

  /** Bounded signal history read. */
  signalWindow(ids: string[], windowMinutes: number, maxPoints = MAX_SIGNAL_POINTS): {
    signals: { id: string; name: string; unit: string; latest: number; points: [number, number][] }[];
    unknown: string[];
    windowMinutes: number;
    truncatedIds: string[];
  } {
    const uniq = Array.from(new Set(ids.map(String)));
    const truncatedIds = uniq.slice(MAX_SIGNAL_IDS);
    const take = uniq.slice(0, MAX_SIGNAL_IDS);
    const unknown = take.filter((id) => !isKnownSignal(id));
    const maxMin = this.historyCap * MINUTES_PER_STEP;
    const win = Math.max(MINUTES_PER_STEP, Math.min(maxMin, Number(windowMinutes) || 30));
    const nWant = Math.max(1, Math.round(win / MINUTES_PER_STEP));
    const n = Math.min(nWant, this.hist.t.length);
    const start = this.hist.t.length - n;
    const pts = Math.max(2, Math.min(MAX_SIGNAL_POINTS, maxPoints));
    const stride = Math.max(1, Math.ceil(n / pts));
    const signals = take.filter(isKnownSignal).map((id) => {
      const arr = this.hist.v[id];
      const points: [number, number][] = [];
      for (let i = this.hist.t.length - 1; i >= start; i -= stride) points.push([+this.hist.t[i].toFixed(3), +arr[i].toFixed(4)]);
      points.reverse();
      return { id, name: SIG[id][0], unit: SIG[id][1], latest: +this.plant.VAL[id].toFixed(4), points };
    });
    return { signals, unknown, windowMinutes: +(n * MINUTES_PER_STEP).toFixed(1), truncatedIds };
  }
}

export { STEP_H, MINUTES_PER_STEP };
