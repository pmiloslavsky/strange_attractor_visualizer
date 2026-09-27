import { defineAttractor } from './types';

export const lorenz = defineAttractor({
  id: 'lorenz',
  name: 'Lorenz',
  equations: ['dx/dt = σ(y − x)', 'dy/dt = x(ρ − z) − y', 'dz/dt = xy − βz'],
  params: [
    { name: 'sigma', min: 1, max: 100 },
    { name: 'beta', min: 0, max: 10 },
    { name: 'rho', min: 1, max: 100 },
  ],
  examples: [
    [10.0, 8.0 / 3.0, 28.0],
    [12.69, 0.13, 53.03],
    [95.03, 0.19, 82.7],
  ],
  dt: 0.003,
  particleSize: 0.33,
  seedRange: [-1, 1],
  simSpeed: 0.25,
  // ρ: fixed points below ≈ 24.7, then chaos with periodic windows.
  sweep: { param: 2, from: 10, to: 100 },
  // The plane z = ρ − 1 through the two off-center fixed points.
  section: { axis: 2, offset: 27 },
  derivative(x, y, z, [sigma, beta, rho], out) {
    out[0] = sigma * (y - x);
    out[1] = x * (rho - z) - y;
    out[2] = x * y - beta * z;
  },
});
