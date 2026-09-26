import { defineAttractor } from './types';

export const rossler = defineAttractor({
  id: 'rossler',
  name: 'Rossler',
  equations: ['dx/dt = −(y + z)', 'dy/dt = x + ay', 'dz/dt = b + z(x − c)'],
  params: [
    { name: 'a', min: -100, max: 100 },
    { name: 'b', min: -100, max: 100 },
    { name: 'c', min: -100, max: 100 },
  ],
  examples: [
    [0.2, 0.2, 5.7],
    [0.1, 0.1, 14.0],
  ],
  // The original used dt = 0.01, but with Euler that step is coarse enough to
  // turn the chaotic c = 5.7 attractor into a periodic loop (the chaos meter
  // reads λ ≈ 0). At 0.002 it is chaotic, λ ≈ 0.06, near the true ≈ 0.071.
  dt: 0.002,
  particleSize: 0.33,
  seedRange: [-1, 1],
  simSpeed: 3,
  // The textbook period-doubling route: one loop, two, four, … then chaos.
  sweep: { param: 2, from: 2, to: 12 },
  derivative(x, y, z, [a, b, c], out) {
    out[0] = -(y + z);
    out[1] = a * y + x;
    out[2] = b + z * (x - c);
  },
});
