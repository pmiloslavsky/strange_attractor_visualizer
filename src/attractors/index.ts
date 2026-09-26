import { aizawa } from './aizawa';
import { chenLee } from './chenLee';
import { dadras } from './dadras';
import { lorenz } from './lorenz';
import { rossler } from './rossler';
import { thomas } from './thomas';
import { threeScroll } from './threeScroll';
import type { Attractor } from './types';

export * from './types';

/** Mirrors the original `vector<StrangeAttractorDE> DE` table, same order. */
export const ATTRACTORS: readonly Attractor[] = [
  lorenz,
  chenLee,
  rossler,
  aizawa,
  threeScroll,
  thomas,
  dadras,
];

export function getAttractor(id: string): Attractor {
  const a = ATTRACTORS.find((a) => a.id === id);
  if (!a) throw new Error(`Unknown attractor: ${id}`);
  return a;
}

/**
 * Global control ranges from the original GUI. These are not per-attractor.
 * Particle count was capped at 256 by the CPU renderer; the GPU path raises it.
 */
export const CONTROL_RANGES = {
  dt: { min: 0.0001, max: 0.05 },
  particleSize: { min: 0.01, max: 4.0 },
  trailLength: { min: 1, max: 30000, default: 5000 },
  particles: { min: 1, max: 256, default: 100 },
} as const;
