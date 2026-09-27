import { defineAttractor } from './types';

// Leipnik & Newton (1981): Euler's rigid-body equations with linear feedback.
// Two separate strange attractors coexist, an upper one (mean z ≈ +0.23) and a
// lower one (mean z ≈ −0.12).
//
// dt matters here: with Euler at dt = 0.01 the integration error is large
// enough to merge both into one distorted attractor. At 0.002 they are
// distinct and match RK4.
export const newtonLeipnik = defineAttractor({
  id: 'newton-leipnik',
  name: 'Newton–Leipnik',
  equations: ['dx/dt = −ax + y + 10yz', 'dy/dt = −x − 0.4y + 5xz', 'dz/dt = bz − 5xy'],
  params: [
    { name: 'a', min: 0, max: 1 },
    { name: 'b', min: 0, max: 0.5 },
  ],
  examples: [[0.4, 0.175]],
  dt: 0.002,
  particleSize: 0.006,
  seedRange: [-0.5, 0.5],
  simSpeed: 1,
  derivative(x, y, z, [a, b], out) {
    out[0] = -a * x + y + 10 * y * z;
    out[1] = -x - 0.4 * y + 5 * x * z;
    out[2] = b * z - 5 * x * y;
  },
  basins: {
    // Upper and lower attractor.
    seeds: [
      [0.349, 0, -0.16],
      [0.349, 0, -0.18],
    ],
    // The z = 0 plane: here the upper attractor's basin is a bowtie shape.
    region: { min: [-1, -1, -0.005], max: [1, 1, 0.005] },
  },
});
