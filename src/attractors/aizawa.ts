import { defineAttractor } from './types';

export const aizawa = defineAttractor({
  id: 'aizawa',
  name: 'Aizawa',
  equations: [
    'dx/dt = (z − b)x − dy',
    'dy/dt = dx + (z − b)y',
    'dz/dt = c + az − z³/3 − (x² + y²)(1 + ez) + fzx³',
  ],
  params: [
    { name: 'a', min: -100, max: 100 },
    { name: 'b', min: -100, max: 100 },
    { name: 'c', min: -100, max: 100 },
    { name: 'd', min: -100, max: 100 },
    { name: 'e', min: -100, max: 100 },
    { name: 'f', min: -100, max: 100 },
  ],
  examples: [[0.95, 0.7, 0.6, 3.5, 0.25, 0.1]],
  dt: 0.01,
  particleSize: 0.03,
  seedRange: [-1, 1],
  simSpeed: 0.75,
  derivative(x, y, z, [a, b, c, d, e, f], out) {
    out[0] = (z - b) * x - d * y;
    out[1] = d * x + (z - b) * y;
    out[2] = c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * (z * x * x * x);
  },
});
