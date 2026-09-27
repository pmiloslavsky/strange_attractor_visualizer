import { defineAttractor } from './types';

export const chenLee = defineAttractor({
  id: 'chen-lee',
  name: 'Chen-Lee',
  equations: ['dx/dt = ax − yz', 'dy/dt = by + xz', 'dz/dt = cz + xy/3'],
  params: [
    { name: 'a', min: -100, max: 100 },
    { name: 'b', min: -100, max: 100 },
    { name: 'c', min: -100, max: 100 },
  ],
  examples: [[5.0, -10.0, -0.38]],
  dt: 0.001,
  particleSize: 0.33,
  seedRange: [-1, 1],
  simSpeed: 0.4,
  derivative(x, y, z, [a, b, c], out) {
    out[0] = a * x - y * z;
    out[1] = b * y + x * z;
    out[2] = c * z + (x * y) / 3.0;
  },
});
