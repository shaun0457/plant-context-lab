/**
 * Seeded pseudo-random source (mulberry32) with a serialisable 32-bit state.
 *
 * The browser demo used Math.random(); the engine injects this source instead so
 * that a branch copy of the plant replays exactly the same noise as its parent,
 * and so that offline PCA training is reproducible from fixed seeds.
 */
export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

/** Uniform in [0, 1). Mutates the state. */
export function uniform(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standard normal via Box-Muller, written exactly like the original page's gauss(). */
export function gauss(r: RngState): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = uniform(r);
  while (v === 0) v = uniform(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
