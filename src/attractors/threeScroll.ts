import { defineAttractor } from './types';

export const threeScroll = defineAttractor({
  id: 'three-scroll',
  name: 'Three-Scroll-Unified',
  equations: ['dx/dt = a(y − x) + dxz', 'dy/dt = bx − xz + fy', 'dz/dt = cz + xy − ex²'],
  params: [
    { name: 'a', min: -100, max: 100 },
    { name: 'b', min: -100, max: 100 },
    { name: 'c', min: -100, max: 100 },
    { name: 'd', min: -100, max: 100 },
    { name: 'e', min: -100, max: 100 },
    { name: 'f', min: -100, max: 100 },
  ],
  examples: [[40.0, 55.0, 11.0 / 6.0, 0.16, 0.65, 20.0]],
  dt: 0.0001,
  particleSize: 2.03,
  seedRange: [-1, 1],
  simSpeed: 0.075,
  derivative(x, y, z, [a, b, c, d, e, f], out) {
    out[0] = a * (y - x) + d * x * z;
    out[1] = b * x - x * z + f * y;
    out[2] = c * z + x * y - e * x * x;
  },
});
