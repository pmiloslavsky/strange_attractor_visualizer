import { defineAttractor } from './types';

// Dimensionless Chua circuit with the classic 3-segment piecewise-linear diode:
// slope m0 for |x| < 1, m1 outside. Parameters from chuacircuits.com's
// reference MATLAB model (double scroll) and the other standard set.
export const chua = defineAttractor({
  id: 'chua',
  name: 'Chua',
  equations: ['dx/dt = α(y − x − f(x))', 'dy/dt = x − y + z', 'dz/dt = −βy', 'f(x) = m1·x + ½(m0 − m1)(|x+1| − |x−1|)'],
  params: [
    { name: 'alpha', min: 5, max: 25 },
    { name: 'beta', min: 5, max: 40 },
    { name: 'm0', min: -2, max: 0 },
    { name: 'm1', min: -1.5, max: 0 },
  ],
  examples: [
    [15.6, 28, -1.143, -0.714], // double scroll
    [9, 14.286, -1.143, -0.714], // double scroll (other standard set)
    [8.5, 14.286, -1.143, -0.714], // single scroll: stays on one side
    [8.2, 14.286, -1.143, -0.714], // periodic loop, before the single scroll turns chaotic
  ],
  exampleNames: ['Double scroll', 'Double scroll (α = 9)', 'Single scroll (α = 8.5)', 'Periodic loop (α = 8.2)'],
  dt: 0.002,
  particleSize: 0.04,
  seedRange: [-1, 1],
  simSpeed: 1,
  derivative(x, y, z, [alpha, beta, m0, m1], out) {
    const fx = m1 * x + 0.5 * (m0 - m1) * (Math.abs(x + 1) - Math.abs(x - 1));
    out[0] = alpha * (y - x - fx);
    out[1] = x - y + z;
    out[2] = -beta * y;
  },
});
