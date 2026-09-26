import { defineMap } from './types';

// Examples from Paul Bourke, https://paulbourke.net/fractals/peterdejong/
// (his third set is listed first here because it makes the best default).
export const deJong = defineMap({
  id: 'de-jong',
  name: 'Peter de Jong',
  equations: ['x′ = sin(a·y) − cos(b·x)', 'y′ = sin(c·x) − cos(d·y)'],
  params: [
    { name: 'a', min: -3, max: 3 },
    { name: 'b', min: -3, max: 3 },
    { name: 'c', min: -3, max: 3 },
    { name: 'd', min: -3, max: 3 },
  ],
  examples: [
    [1.4, -2.3, 2.4, -2.1],
    [1.641, 1.902, 0.316, 1.525],
    [0.97, -1.899, 1.381, -1.506],
    [2.01, -2.53, 1.61, -0.33],
    [-2.7, -0.09, -0.86, -2.2],
    [-0.827, -1.637, 1.659, -0.943],
    [-2.24, 0.43, -0.65, -2.43],
    [-2, -2, -1.2, 2],
    [-0.709, 1.638, 0.452, 1.74],
  ],
  particleSize: 0.01,
  seedRange: [-1, 1],
  simSpeed: 30,
  map(x, y, [a, b, c, d], out) {
    out[0] = Math.sin(a * y) - Math.cos(b * x);
    out[1] = Math.sin(c * x) - Math.cos(d * y);
  },
});
