/**
 * Shared engine entry. Plain TypeScript, no DOM access. Bundled as an IIFE
 * (global PCL) into the static page, and imported by the local server.
 */
import PCA_MODEL_JSON from './pca-model.json' with { type: 'json' };
import type { PcaModel } from './pca.ts';
import { Simulation, type SimOptions } from './simulation.ts';

export const PCA_MODEL = PCA_MODEL_JSON as unknown as PcaModel;

export function createSimulation(opt: SimOptions = {}): Simulation {
  return new Simulation({ pcaModel: PCA_MODEL, ...opt });
}

export * from './rng.ts';
export * from './signals.ts';
export * from './topology.ts';
export * from './knowledge.ts';
export * from './plant.ts';
export * from './rules.ts';
export * from './pca.ts';
export * from './simulation.ts';
export * from './gate.ts';
export * from './context.ts';
