import { defineAttractor } from './types';

export const thomas = defineAttractor({
  id: 'thomas',
  name: 'Thomas',
  equations: ['dx/dt = sin(y) − bx', 'dy/dt = sin(z) − by', 'dz/dt = sin(x) − bz'],
  params: [{ name: 'b', min: -2, max: 2 }],
  examples: [[0.208186], [0.1998], [0.32899]],
  dt: 0.01,
  particleSize: 0.03,
  seedRange: [-1, 1],
  simSpeed: 2,
  // From the Hopf loop at b ≈ 0.329 down through period doubling into chaos.
  sweep: { param: 0, from: 0.1, to: 0.35 },
  derivative(x, y, z, [b], out) {
    out[0] = Math.sin(y) - b * x;
    out[1] = Math.sin(z) - b * y;
    out[2] = Math.sin(x) - b * z;
  },
});
