/**
 * Offline PCA training. Generates normal-operation data from the engine's own
 * lumped model with fixed seeds and writes src/engine/pca-model.json.
 *
 *   npm run train:pca
 *
 * Normal operation here means: XMV(10) loop in AUTO, no disturbance, plus small
 * operator moves (the loop is put in MANUAL at the current output +/- up to 3 %
 * for 18-54 min, then returned to AUTO). The moves teach the monitor how the
 * plant normally responds to the cooling valve, so a later operator move that
 * follows that physics stays in the principal subspace (T²) while a broken
 * correlation, such as the valve opening with no matching temperature change,
 * shows up in SPE. No disturbance (IDV) data is used, and no labels exist.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRng, uniform } from '../src/engine/rng.ts';
import { fitPca, scorePca, windowMean, type PcaModel } from '../src/engine/pca.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { MODELLED_SIGNALS } from '../src/engine/signals.ts';

const VARS = MODELLED_SIGNALS.slice();
const WINDOW = 5;
const TRAIN_SEEDS = [101, 202, 303, 404, 505, 606];
const HOLDOUT_SEEDS = [707, 808];
const STEPS_PER_RUN = 3000; // 30 simulated hours per seed, after warm-up
const MOVE_MAX = 3; // % of valve range
const CONFIDENCE = 0.99;
const VARIANCE_TARGET = 0.9;

function runNormal(seed: number, withMoves: boolean): number[][] {
  const sim = new Simulation({ seed, warmup: 480, historyCap: 0, pcaModel: null });
  const ex = createRng(seed * 7919 + 13);
  const buf: number[][] = [];
  const rows: number[][] = [];
  let left = 30 + Math.floor(uniform(ex) * 60);
  for (let i = 0; i < STEPS_PER_RUN; i++) {
    if (withMoves && --left <= 0) {
      if (sim.plant.mode === 'AUTO') {
        const target = sim.plant.M.u + (uniform(ex) * 2 - 1) * MOVE_MAX;
        sim.plant.mode = 'MANUAL';
        sim.plant.uMan = Math.max(0, Math.min(100, target));
      } else {
        sim.restoreAuto('training');
      }
      left = 30 + Math.floor(uniform(ex) * 60);
    }
    sim.step();
    buf.push(VARS.map((id) => sim.plant.VAL[id]));
    if (buf.length > WINDOW) buf.shift();
    if (buf.length === WINDOW) rows.push(windowMean(buf, WINDOW) as number[]);
  }
  return rows;
}

function falseAlarmRate(model: PcaModel, rows: number[][]): { t2: number; spe: number; any: number } {
  let a = 0; let b = 0; let c = 0;
  rows.forEach((r) => { const s = scorePca(model, r); if (s.exceeded.t2) a++; if (s.exceeded.spe) b++; if (s.exceeded.any) c++; });
  return { t2: +(a / rows.length).toFixed(4), spe: +(b / rows.length).toFixed(4), any: +(c / rows.length).toFixed(4) };
}

const train: number[][] = [];
TRAIN_SEEDS.forEach((s) => train.push(...runNormal(s, true)));
const model = fitPca(train, {
  variables: VARS,
  window: WINDOW,
  varianceTarget: VARIANCE_TARGET,
  confidence: CONFIDENCE,
  training: {
    generator: 'scripts/train-pca.ts (engine lumped model)',
    seeds: TRAIN_SEEDS,
    holdoutSeeds: HOLDOUT_SEEDS,
    warmupSteps: 480,
    stepsPerSeed: STEPS_PER_RUN,
    sampleHours: 0.01,
    rows: train.length,
    operatingMode: 'XMV(10) loop AUTO, no disturbance, plus operator moves of up to +/-' + MOVE_MAX + ' % held 18-54 min',
    preprocessing: WINDOW + '-sample moving mean, autoscaled with training mean and standard deviation',
    componentRule: 'smallest k with cumulative explained variance >= ' + VARIANCE_TARGET,
    limits: 'empirical ' + CONFIDENCE * 100 + ' % quantile of training T² and SPE',
    labels: 'none; the monitor outputs scores and contributors only',
  },
});
const hold: number[][] = [];
HOLDOUT_SEEDS.forEach((s) => hold.push(...runNormal(s, true)));
const holdAuto: number[][] = [];
HOLDOUT_SEEDS.forEach((s) => holdAuto.push(...runNormal(s, false)));
model.training.holdoutFalseAlarm = falseAlarmRate(model, hold);
model.training.holdoutFalseAlarmAutoOnly = falseAlarmRate(model, holdAuto);

const round = (v: number) => +v.toPrecision(10);
const out: PcaModel = {
  ...model,
  mean: model.mean.map(round),
  scale: model.scale.map(round),
  loadings: model.loadings.map((r) => r.map(round)),
  eigenvalues: model.eigenvalues.map(round),
  allEigenvalues: model.allEigenvalues.map(round),
  explainedVariance: round(model.explainedVariance),
};
const path = fileURLToPath(new URL('../src/engine/pca-model.json', import.meta.url));
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
process.stderr.write('PCA: k=' + out.k + ' explained=' + out.explainedVariance.toFixed(3) + ' T2lim=' + out.t2Limit + ' SPElim=' + out.speLimit +
  ' rows=' + train.length + ' holdout FA=' + JSON.stringify(model.training.holdoutFalseAlarm) + ' autoOnly FA=' + JSON.stringify(model.training.holdoutFalseAlarmAutoOnly) + '\nwrote src/engine/pca-model.json\n');
