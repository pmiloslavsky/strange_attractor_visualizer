import { describe, expect, it } from 'vitest';
import { getAttractor } from '../attractors';
import { PoincareSection } from './poincare';
import { ParticleSystem } from './ParticleSystem';

/** Cluster the in-plane coordinates of the section's points (greedy, by tolerance). */
function clusters(sec: PoincareSection, tol: number): number {
  const [u, v] = [0, 1, 2].filter((k) => k !== sec.axis) as [number, number];
  const centers: [number, number][] = [];
  for (let i = 0; i < sec.count; i++) {
    const x = sec.points[3 * i + u]!, y = sec.points[3 * i + v]!;
    if (!centers.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < tol)) centers.push([x, y]);
  }
  return centers.length;
}

function runSection(params: number[]) {
  const sys = new ParticleSystem(getAttractor('rossler'), 50, 4);
  sys.setParams(params);
  sys.reseed();
  for (let i = 0; i < 2000; i++) sys.advance(0.05); // settle for 100 time units
  const sec = new PoincareSection();
  sec.set(1, 0); // classic Rössler section: y = 0, crossing upward
  for (let i = 0; i < 1500; i++) {
    sys.advance(0.05);
    sec.collect(sys);
  }
  return sec;
}

describe('PoincareSection', () => {
  it('records crossings exactly on the plane', () => {
    const sec = runSection([0.2, 0.2, 5.7]);
    expect(sec.count).toBeGreaterThan(500);
    for (let i = 0; i < sec.count; i++) expect(sec.points[3 * i + 1]).toBe(0);
  });

  it('a periodic loop is one dot; after period doubling, two', () => {
    expect(clusters(runSection([0.2, 0.2, 2.5]), 0.15)).toBe(1);
    expect(clusters(runSection([0.2, 0.2, 3.5]), 0.15)).toBe(2);
  });
});
