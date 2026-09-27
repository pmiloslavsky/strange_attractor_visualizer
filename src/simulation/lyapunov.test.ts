import { describe, expect, it } from 'vitest';
import { getAttractor } from '../attractors';
import { rk4 } from './integrators';
import { LyapunovMeter } from './lyapunov';
import { ParticleSystem } from './ParticleSystem';

/** Run the meter until it has a verdict (or give up). */
function measure(id: string, params?: number[], frames = 3000) {
  const a = getAttractor(id);
  const sys = new ParticleSystem(a, 4, 2);
  if (params) sys.setParams(params);
  const meter = new LyapunovMeter(sys);
  for (let i = 0; i < frames; i++) meter.tick();
  return meter.reading();
}

describe('LyapunovMeter', () => {
  it('Lorenz (classic parameters) is chaotic with λ ≈ 0.9', () => {
    const r = measure('lorenz');
    expect(r.verdict).toBe('chaotic');
    // Literature value ≈ 0.906; Euler at dt = 0.003 is close but not exact.
    expect(r.lambda).toBeGreaterThan(0.8);
    expect(r.lambda).toBeLessThan(1.0);
  });

  it('with RK4, Lorenz matches the published λ ≈ 0.906', () => {
    const sys = new ParticleSystem(getAttractor('lorenz'), 4, 2);
    sys.integrator = rk4;
    const meter = new LyapunovMeter(sys);
    for (let i = 0; i < 4000; i++) meter.tick();
    expect(meter.reading().lambda).toBeCloseTo(0.906, 1);
  });

  it('Lorenz below the chaos threshold (ρ = 10) settles to a fixed point', () => {
    expect(measure('lorenz', [10, 8 / 3, 10]).verdict).toBe('fixed point');
  });

  it('Rössler (0.2, 0.2, 5.7) is chaotic with a small λ ≈ 0.07', () => {
    const r = measure('rossler');
    expect(r.verdict).toBe('chaotic');
    expect(r.lambda).toBeGreaterThan(0.04);
    expect(r.lambda).toBeLessThan(0.11);
  });

  it('Rössler at c = 2.5 is a periodic loop', () => {
    expect(measure('rossler', [0.2, 0.2, 2.5]).verdict).toBe('periodic');
  });
});
