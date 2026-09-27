import { describe, expect, it } from 'vitest';
import { analyze } from '../simulation/analysis';
import { euler } from '../simulation/integrators';
import { ATTRACTORS, eulerStep, getAttractor } from './index';

describe('attractor registry', () => {
  it('has the original 7 systems in order, then the added ones, with unique ids', () => {
    expect(ATTRACTORS.map((a) => a.name)).toEqual([
      'Lorenz',
      'Chen-Lee',
      'Rossler',
      'Aizawa',
      'Three-Scroll-Unified',
      'Thomas',
      'Dadras',
      'Chua',
      'Newton–Leipnik',
    ]);
    expect(new Set(ATTRACTORS.map((a) => a.id)).size).toBe(ATTRACTORS.length);
  });

  it.each(ATTRACTORS.map((a) => [a.name, a] as const))('%s metadata is consistent', (_, a) => {
    expect(a.examples.length).toBeGreaterThanOrEqual(1);
    expect(a.examples.length).toBeLessThanOrEqual(4);
    expect(a.exampleNames).toHaveLength(a.examples.length);
    for (const ex of a.examples) expect(ex).toHaveLength(a.params.length);
    for (const spec of a.params) expect(spec.min).toBeLessThan(spec.max);
    expect(a.dt).toBeGreaterThan(0);
  });

  it.each(ATTRACTORS.map((a) => [a.name, a] as const))(
    '%s stays finite and bounded with its default example',
    (_, a) => {
      const pos = new Float32Array([0.1, 0.2, 0.3, -0.5, 0.4, 0.9]);
      const p = a.examples[0]!;
      for (let i = 0; i < 20000; i++) euler(a.derivative, pos, 2, p, a.dt);
      for (const v of pos) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(1e4);
      }
    },
  );
});

describe('presets', () => {
  it.each(ATTRACTORS.flatMap((a) => a.examples.map((ex, i) => [`${a.name}: ${a.exampleNames[i]}`, a, ex] as const)))(
    '%s stays bounded and does not collapse',
    (_, a, ex) => {
      const r = analyze(a, ex, a.dt);
      expect(r.ok).toBe(true);
      expect(r.collapsed).toBe(false);
    },
  );
});

describe('eulerStep matches the original C++ apply_lorenz_de', () => {
  it('computes one step by hand', () => {
    const lorenz = getAttractor('lorenz');
    const [sigma, beta, rho] = [10, 8 / 3, 28];
    const [x, y, z, dt] = [1, 2, 3, 0.003];
    const expected = [
      x + dt * sigma * (y - x),
      y + dt * (x * (rho - z) - y),
      z + dt * (x * y - beta * z),
    ];
    const got = eulerStep(lorenz, x, y, z, [sigma, beta, rho], dt);
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 12));
  });
});
