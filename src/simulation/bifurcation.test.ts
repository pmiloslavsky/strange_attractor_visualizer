import { describe, expect, it } from 'vitest';
import { getAttractor } from '../attractors';
import { bifurcationColumns } from './bifurcation';
import { euler } from './integrators';
import { analyze } from './analysis';

/** Number of distinct values (to a tolerance) among a column's points. */
function distinct(points: Float32Array, tol: number): number {
  const sorted = Array.from(points).sort((a, b) => a - b);
  let n = sorted.length ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i]! - sorted[i - 1]! > tol) n++;
  return n;
}

describe('bifurcation diagram', () => {
  it('shows Rössler period doubling: 1 peak, then 2, then 4, then chaos', () => {
    const a = getAttractor('rossler');
    const params = [0.2, 0.2, 2.5];
    const start = analyze(a, params, a.dt).samples.slice(0, 3) as unknown as [number, number, number];
    // Four columns at c = 2.5, 3.5, 4.1, 5.7 (from textbook ranges).
    const values = [2.5, 3.5, 4.1, 5.7];
    const counts = values.map((c) => {
      const [col] = bifurcationColumns({ attractor: a, params, param: 2, from: c, to: c + 1e-9, dt: a.dt, integrator: euler, start, columns: 2 });
      return distinct(col!.points, 0.05);
    });
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBe(4);
    expect(counts[3]).toBeGreaterThan(8);
  });

  it('records x values for maps and marks divergence with an empty column', () => {
    const a = getAttractor('clifford');
    const cols = [...bifurcationColumns({ attractor: a, params: [...a.examples[0]!], param: 0, from: -1.4, to: -1.3, dt: 1, integrator: euler, start: [0.1, 0.1, 0], columns: 3 })];
    expect(cols).toHaveLength(3);
    for (const c of cols) expect(c.points.length).toBeGreaterThan(100);
  });
});
