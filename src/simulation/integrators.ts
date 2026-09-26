import type { Derivative, Vec3 } from '../attractors';

/**
 * Integrators operate in place on a packed xyz array (Float32Array for the
 * particles, the same layout the GPU buffers use; Float64Array where precision
 * matters, like the chaos meter), advancing `count` points by one step.
 */
export type Integrator = (
  f: Derivative,
  pos: Float32Array | Float64Array,
  count: number,
  p: readonly number[],
  dt: number,
) => void;

const k1: Vec3 = [0, 0, 0];
const k2: Vec3 = [0, 0, 0];
const k3: Vec3 = [0, 0, 0];
const k4: Vec3 = [0, 0, 0];

/** Explicit Euler — identical to the original C++. */
export const euler: Integrator = (f, pos, count, p, dt) => {
  for (let i = 0, o = 0; i < count; i++, o += 3) {
    const x = pos[o]!, y = pos[o + 1]!, z = pos[o + 2]!;
    f(x, y, z, p, k1);
    pos[o] = x + dt * k1[0];
    pos[o + 1] = y + dt * k1[1];
    pos[o + 2] = z + dt * k1[2];
  }
};

/**
 * Classic RK4. Same trajectories as Euler at small dt, but stays stable at
 * much larger dt, which means smoother motion for the same cost per frame.
 */
export const rk4: Integrator = (f, pos, count, p, dt) => {
  const h = dt / 2;
  for (let i = 0, o = 0; i < count; i++, o += 3) {
    const x = pos[o]!, y = pos[o + 1]!, z = pos[o + 2]!;
    f(x, y, z, p, k1);
    f(x + h * k1[0], y + h * k1[1], z + h * k1[2], p, k2);
    f(x + h * k2[0], y + h * k2[1], z + h * k2[2], p, k3);
    f(x + dt * k3[0], y + dt * k3[1], z + dt * k3[2], p, k4);
    const s = dt / 6;
    pos[o] = x + s * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    pos[o + 1] = y + s * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    pos[o + 2] = z + s * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  }
};
