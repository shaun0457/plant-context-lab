import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSimulation, PCA_MODEL } from '../src/engine/index.ts';
import { eigSym, fitPca, scorePca } from '../src/engine/pca.ts';
import { MODELLED_SIGNALS } from '../src/engine/signals.ts';

test('trained model is well formed', () => {
  const m = PCA_MODEL;
  assert.equal(m.format, 'pca-monitor/1');
  assert.deepEqual(m.variables, MODELLED_SIGNALS.slice());
  assert.equal(m.confidence, 0.99);
  assert.ok(m.k >= 1 && m.k < m.variables.length);
  assert.equal(m.loadings.length, m.variables.length);
  assert.equal(m.loadings[0].length, m.k);
  assert.ok(m.t2Limit > 0 && m.speLimit > 0);
  assert.ok(Array.isArray(m.training.seeds));
  assert.equal(m.training.labels, 'none; the monitor outputs scores and contributors only');
});

test('normal operation stays below threshold; IDV(4) exceeds it', () => {
  const sim = createSimulation({ seed: 3 });
  let exceeded = 0;
  for (let i = 0; i < 300; i++) { sim.step(); if (sim.safety().pca!.exceeded.any) exceeded++; }
  assert.ok(exceeded <= 6, 'false alarms in 300 normal samples: ' + exceeded);
  sim.injectIdv4(5);
  sim.step(30);
  const s = sim.safety().pca!;
  assert.equal(s.exceeded.any, true);
  assert.ok(s.score > 1);
  assert.deepEqual(s.contributors.slice(0, 2).map((c) => c.signal).sort(), ['XMEAS(21)', 'XMV(10)']);
});

test('threshold behaviour: exceeded <=> statistic > limit, score = max ratio', () => {
  const sim = createSimulation({ seed: 9 });
  sim.injectIdv4(10);
  for (let i = 0; i < 60; i++) {
    sim.step();
    const p = sim.safety().pca!;
    assert.equal(p.exceeded.t2, p.t2 / p.t2Limit > 1);
    assert.equal(p.exceeded.spe, p.spe / p.speLimit > 1);
    assert.equal(p.exceeded.any, p.exceeded.t2 || p.exceeded.spe);
    assert.ok(Math.abs(p.score - Math.max(p.t2 / p.t2Limit, p.spe / p.speLimit)) < 0.01);
  }
  const x = PCA_MODEL.mean.slice();
  const atMean = scorePca(PCA_MODEL, x);
  assert.ok(atMean.t2 < 1e-6 && atMean.spe < 1e-6);
});

test('the monitor never outputs a fault label', () => {
  const sim = createSimulation({ seed: 5 });
  sim.injectIdv4(10);
  sim.step(40);
  const p = sim.safety().pca!;
  assert.deepEqual(Object.keys(p).sort(), ['contributors', 'dominant', 'exceeded', 't2', 't2Limit', 'score', 'spe', 'speLimit'].sort());
  const text = JSON.stringify(p) + JSON.stringify(PCA_MODEL);
  assert.doesNotMatch(text, /IDV|fault|class|label"/i);
  for (const c of p.contributors) assert.deepEqual(Object.keys(c).sort(), ['direction', 'share', 'signal']);
});

test('eigSym and fitPca are correct and deterministic', () => {
  const A = [[4, 1, 0], [1, 3, 0], [0, 0, 1]];
  const { values, vectors } = eigSym(A);
  for (let i = 0; i < 3; i++) {
    for (let r = 0; r < 3; r++) {
      const av = A[r].reduce((s, a, c) => s + a * vectors[c][i], 0);
      assert.ok(Math.abs(av - values[i] * vectors[r][i]) < 1e-9);
    }
  }
  assert.ok(values[0] >= values[1] && values[1] >= values[2]);
  const rows = Array.from({ length: 200 }, (_, i) => [Math.sin(i), Math.sin(i) * 2 + 0.01 * Math.cos(7 * i), Math.cos(i)]);
  const opt = { variables: ['a', 'b', 'c'], window: 1, varianceTarget: 0.9, confidence: 0.99, training: {} };
  assert.deepEqual(fitPca(rows, opt), fitPca(rows, opt));
});
