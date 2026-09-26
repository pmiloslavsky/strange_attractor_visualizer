import { defineMap } from './types';

// Examples from Paul Bourke, https://paulbourke.net/fractals/clifford/
export const clifford = defineMap({
  id: 'clifford',
  name: 'Clifford',
  equations: ['x′ = sin(a·y) + c·cos(a·x)', 'y′ = sin(b·x) + d·cos(b·y)'],
  params: [
    { name: 'a', min: -3, max: 3 },
    { name: 'b', min: -3, max: 3 },
    { name: 'c', min: -3, max: 3 },
    { name: 'd', min: -3, max: 3 },
  ],
  examples: [
    [-1.4, 1.6, 1.0, 0.7],
    [1.6, -0.6, -1.2, 1.6],
    [1.7, 1.7, 0.6, 1.2],
    [1.5, -1.8, 1.6, 0.9],
    [-1.7, 1.3, -0.1, -1.2],
    [-1.7, 1.8, -1.9, -0.4],
    [-1.8, -2.0, -0.5, -0.9],
  ],
  particleSize: 0.01,
  seedRange: [-1, 1],
  simSpeed: 30,
  map(x, y, [a, b, c, d], out) {
    out[0] = Math.sin(a * y) + c * Math.cos(a * x);
    out[1] = Math.sin(b * x) + d * Math.cos(b * y);
  },
});
