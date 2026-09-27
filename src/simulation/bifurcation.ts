import type { Attractor } from '../attractors';
import type { Integrator } from './integrators';

export interface BifurcationRequest {
  attractor: Attractor;
  /** All parameters; only `param` varies across the diagram. */
  params: readonly number[];
  param: number;
  from: number;
  to: number;
  dt: number;
  integrator: Integrator;
  /** Where to start the first column (a point on the attractor). */
  start: readonly [number, number, number];
  columns?: number;
}

/** One column of the diagram: the recorded values at one parameter value. */
export interface BifurcationColumn {
  index: number;
  value: number;
  /** Local maxima of z (or the resting z at a fixed point); empty if it diverged. */
  points: Float32Array;
}

const MAX_POINTS = 240;
const ESCAPE = 1e6;

/**
 * The classic bifurcation diagram, computed column by column. For each value
 * of one parameter, integrate a single trajectory, skip a transient, and
 * record what it settles into: the local maxima of z (one point for a simple
 * loop, two after a period doubling, a smear when chaotic).
 *
 * Each column starts where the previous one ended, so the diagram follows
 * the attractor continuously as the parameter changes, as in textbooks.
 * Uses the same equations, dt and integrator as the particles.
 *
 * Returns a generator that yields one column per `next()`, so the caller can
 * spread the work over animation frames and cancel by simply not continuing.
 */
export function* bifurcationColumns(req: BifurcationRequest): Generator<BifurcationColumn> {
  const { attractor: a, param, from, to, dt, integrator } = req;
  const columns = req.columns ?? 240;
  const p = [...req.params];
  const s = new Float64Array(req.start);
  // Model-time budgets, capped in steps so a tiny dt can't stall a frame.
  // Convergence slows near each bifurcation, so the transient is generous;
  // recording ~300 time units gives dozens of peaks even for slow loops.
  const transient = Math.min(Math.round(200 / dt), 150_000);
  const record = Math.min(Math.round(300 / dt), 200_000);

  for (let c = 0; c < columns; c++) {
    const value = from + ((to - from) * c) / (columns - 1);
    p[param] = value;
    const out: number[] = [];
    let ok = true;
    let prev2 = NaN, prev1 = NaN;
    for (let i = 0; i < transient + record && out.length < MAX_POINTS; i++) {
      integrator(a.derivative, s, 1, p, dt);
      if (!(Math.abs(s[0]!) + Math.abs(s[1]!) + Math.abs(s[2]!) < ESCAPE)) {
        ok = false;
        break;
      }
      if (i < transient) continue;
      const v = s[2]!;
      if (prev1 > prev2 && prev1 >= v) out.push(prev1);
      prev2 = prev1;
      prev1 = v;
    }
    // Settled onto a fixed point: no peaks, but its z value is still the answer.
    if (ok && out.length === 0) out.push(s[2]!);
    if (!ok) s.set(req.start); // restart the next column from a sane point
    yield { index: c, value, points: ok ? Float32Array.from(out) : new Float32Array(0) };
  }
}
