/**
 * Attractor metadata + ODE, ported from the original C++ `StrangeAttractorDE`
 * struct and its `apply_*_de` functions.
 *
 * The C++ baked explicit Euler into each apply_* function
 * (`x + dt * f(x)`). Here each attractor only supplies the vector field
 * f(x, y, z) — the math inside the parentheses, verbatim — and the integrator
 * is chosen separately (see src/simulation/integrators.ts). `eulerStep` below
 * reproduces the original step exactly.
 */

export type Vec3 = [number, number, number];

export interface ParamSpec {
  readonly name: string;
  /** Slider range, from the original `MinMax` table. */
  readonly min: number;
  readonly max: number;
}

/** Map a tuple of ParamSpecs to a same-length tuple of numbers. */
export type ParamValues<P extends readonly ParamSpec[]> = { readonly [K in keyof P]: number };

/**
 * Writes d(x,y,z)/dt into `out`. Out-param rather than a returned array so the
 * hot loop (particles × steps per frame) doesn't allocate.
 */
export type Derivative<P extends readonly ParamSpec[] = readonly ParamSpec[]> = (
  x: number,
  y: number,
  z: number,
  p: ParamValues<P>,
  out: Vec3,
) => void;

export interface AttractorDef<P extends readonly ParamSpec[] = readonly ParamSpec[]> {
  readonly id: string;
  readonly name: string;
  /**
   * 'flow': a continuous ODE system (the original seven), drawn with trails.
   * 'map': a 2D iterated map (see defineMap), drawn as a dense point cloud.
   */
  readonly kind: 'flow' | 'map';
  /** Human-readable system, one line per axis, for display in the UI. */
  readonly equations: readonly string[];
  readonly params: P;
  /** Known interesting parameter sets. `examples[0]` is the default. */
  readonly examples: readonly ParamValues<P>[];
  /** Default integration step (original `dt`). */
  readonly dt: number;
  /** Default particle size (original `particle_size`). */
  readonly particleSize: number;
  /** Initial positions are drawn uniformly from this range on each axis (original `RandMinMax`). */
  readonly seedRange: readonly [number, number];
  /**
   * Model time advanced per second of real time. Not in the original (which
   * took one step per frame); tuned per system so each moves at a pleasant pace.
   */
  readonly simSpeed: number;
  readonly derivative: Derivative<P>;
  /**
   * For systems with several coexisting attractors at the default parameters:
   * one starting point known to reach each, and a region of starting points to
   * seed from when showing which attractor each start leads to.
   */
  /** Default Poincaré section plane (axis 0/1/2 = x/y/z, at `offset`), where a classic one exists. */
  readonly section?: { readonly axis: 0 | 1 | 2; readonly offset: number };
  /** Default parameter and range for the sweep / bifurcation diagram, where a classic one exists. */
  readonly sweep?: { readonly param: number; readonly from: number; readonly to: number };
  readonly basins?: {
    readonly seeds: readonly Vec3[];
    readonly region: { readonly min: Vec3; readonly max: Vec3 };
  };
}

/** Type-erased form used by the registry and the rest of the app. */
export type Attractor = AttractorDef<readonly ParamSpec[]>;

/**
 * Identity helper whose only job is type-checking: it ties the length of every
 * example set and the derivative's `p` tuple to the length of `params`, so a
 * missing or extra parameter is a compile error instead of a runtime NaN.
 */
export function defineAttractor<const P extends readonly ParamSpec[]>(
  def: Omit<AttractorDef<P>, 'kind'>,
): Attractor {
  return { ...def, kind: 'flow' } as unknown as Attractor;
}

/** Writes the next point of a 2D map into `out`. */
export type MapFn<P extends readonly ParamSpec[]> = (x: number, y: number, p: ParamValues<P>, out: [number, number]) => void;

/**
 * Define a 2D iterated map (x, y) → (x', y') in terms of the ODE machinery.
 *
 * One explicit Euler step with dt = 1 is x + 1·f(x). Choosing
 * f(x) = map(x) − x makes that step land exactly on map(x), so a map runs
 * through the same particle system, analysis and tests as the flows, with
 * dt fixed at 1 and simSpeed meaning iterations per second. z is pinned to 0
 * (the map lives in the z = 0 plane). Only Euler is valid for maps; RK4 would
 * blend intermediate points that have no meaning for a map.
 */
export function defineMap<const P extends readonly ParamSpec[]>(
  def: Omit<AttractorDef<P>, 'kind' | 'dt' | 'derivative'> & { readonly map: MapFn<P> },
): Attractor {
  const next: [number, number] = [0, 0];
  const { map, ...rest } = def;
  const derivative: Derivative<P> = (x, y, z, p, out) => {
    map(x, y, p, next);
    out[0] = next[0] - x;
    out[1] = next[1] - y;
    out[2] = -z;
  };
  return { ...rest, kind: 'map', dt: 1, derivative } as unknown as Attractor;
}

const scratch: Vec3 = [0, 0, 0];

/**
 * One explicit Euler step — exactly what the original `apply_*_de` functions
 * computed (minus the reference-frame rotation, which the camera now handles).
 */
export function eulerStep(
  a: Attractor,
  x: number,
  y: number,
  z: number,
  p: readonly number[],
  dt: number,
): Vec3 {
  a.derivative(x, y, z, p, scratch);
  return [x + dt * scratch[0], y + dt * scratch[1], z + dt * scratch[2]];
}
