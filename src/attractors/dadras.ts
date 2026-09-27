import { defineAttractor } from './types';

// The original C++ table listed a single MinMax pair ({-50, 50}) for five
// parameters, so its slider setup read past the end of the vector for b..e.
// That range is applied to all five here.
export const dadras = defineAttractor({
  id: 'dadras',
  name: 'Dadras',
  equations: ['dx/dt = y − ax + byz', 'dy/dt = cy − xz + z', 'dz/dt = dxy − ez'],
  params: [
    { name: 'a', min: -50, max: 50 },
    { name: 'b', min: -50, max: 50 },
    { name: 'c', min: -50, max: 50 },
    { name: 'd', min: -50, max: 50 },
    { name: 'e', min: -50, max: 50 },
  ],
  examples: [[3.0, 2.7, 1.7, 2.0, 9.0]],
  dt: 0.001,
  particleSize: 0.03,
  seedRange: [-1, 1],
  simSpeed: 0.6,
  derivative(x, y, z, [a, b, c, d, e], out) {
    out[0] = y - a * x + b * y * z;
    out[1] = c * y - x * z + z;
    out[2] = d * x * y - e * z;
  },
});
