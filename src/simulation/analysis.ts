import type { Attractor, Vec3 } from '../attractors';

/**
 * A long single-particle reference run of the current system. Seeding particles
 * from points on this trajectory puts them on the attractor immediately (no
 * visible warm-up), and its statistics frame the camera and normalize colors.
 */
export interface Analysis {
  /** False if every attempt escaped to infinity; the rest is then a fallback. */
  readonly ok: boolean;
  /** Every bounded attempt settled onto a fixed point instead of an attractor. */
  readonly collapsed: boolean;
  /** Points on the attractor, packed xyz. */
  readonly samples: Float32Array;
  readonly center: Vec3;
  readonly radius: number;
  /** Robust (1st–99th percentile) extent along x, y and z. */
  readonly ranges: readonly [number, number][];
  /** Robust (percentile) range of model-space z, for height coloring. */
  readonly zRange: [number, number];
  /** Robust range of |d(x,y,z)/dt|, for speed coloring. */
  readonly speedRange: [number, number];
  /**
   * Present when the system declares several attractors and they are still
   * distinct at these parameters: which attractor each entry of `samples`
   * belongs to, and a small subsample of each attractor for classifying
   * particles by nearest point.
   */
  readonly basins?: { readonly sampleBasin: Int8Array; readonly probes: readonly Float32Array[] };
}

const STEPS = 200_000;
const SAMPLES = 4096;
const ATTEMPTS = 8;
const ESCAPE = 1e6;
/** Radius (relative to 1 + |center|) below which a run is considered to have collapsed to a point. */
const COLLAPSED = 1e-2;

/** One reference trajectory from (x, y, z), or null if it escapes. */
function run(a: Attractor, p: readonly number[], dt: number, [x, y, z]: Vec3) {
  const d: Vec3 = [0, 0, 0];
  const skip = STEPS >> 2;
  const stride = Math.max(1, Math.floor((STEPS - skip) / SAMPLES));
  const samples = new Float32Array(SAMPLES * 3);
  const speeds = new Float32Array(SAMPLES);
  let n = 0;
  for (let s = 0; s < STEPS && n < SAMPLES; s++) {
    a.derivative(x, y, z, p, d);
    x += dt * d[0];
    y += dt * d[1];
    z += dt * d[2];
    if (!(Math.abs(x) + Math.abs(y) + Math.abs(z) < ESCAPE)) return null;
    if (s >= skip && (s - skip) % stride === 0) {
      samples[3 * n] = x;
      samples[3 * n + 1] = y;
      samples[3 * n + 2] = z;
      speeds[n] = Math.hypot(d[0], d[1], d[2]);
      n++;
    }
  }
  return { samples: samples.subarray(0, n * 3), speeds: speeds.subarray(0, n) };
}

const isCollapsed = (r: Analysis) => r.radius <= COLLAPSED * (1 + Math.hypot(...r.center));

export function analyze(a: Attractor, p: readonly number[], dt: number): Analysis {
  const [lo, hi] = a.seedRange;
  const multi = a.basins && analyzeBasins(a, p, dt);
  if (multi) return multi;

  // Some systems also have stable fixed points (Aizawa has one near
  // (0, 0, -1.3)); a run that lands there collapses to a dot. Retry those and
  // keep the widest result in case every attempt collapses.
  let best: Analysis | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const start: Vec3 = [0, 0, 0].map(() => lo + Math.random() * (hi - lo)) as Vec3;
    const traj = run(a, p, dt, start);
    if (!traj) continue;
    const result = summarize(traj.samples, traj.speeds);
    if (!isCollapsed(result)) return result;
    if (!best || result.radius > best.radius) best = result;
  }
  if (best) return { ...best, collapsed: true };

  // Nothing bounded found (e.g. parameters dragged into a divergent regime).
  const samples = new Float32Array(SAMPLES * 3).map(() => lo + Math.random() * (hi - lo));
  return {
    ok: false,
    collapsed: false,
    samples,
    center: [0, 0, 0],
    radius: Math.max(Math.abs(lo), Math.abs(hi)) * Math.sqrt(3),
    ranges: [[lo, hi], [lo, hi], [lo, hi]],
    zRange: [lo, hi],
    speedRange: [0, 1],
  };
}

const PROBES = 256;

/** Every `n`-th point of a packed xyz array, down to about `count` points. */
function subsample(samples: Float32Array, count: number): Float32Array {
  const n = samples.length / 3;
  const step = Math.max(1, Math.floor(n / count));
  const out = new Float32Array(Math.ceil(n / step) * 3);
  for (let i = 0, j = 0; i < n; i += step, j++) out.set(samples.subarray(3 * i, 3 * i + 3), 3 * j);
  return out;
}

/** Squared distance from (x, y, z) to the nearest point of a packed xyz array. */
export function nearest2(points: Float32Array, x: number, y: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const d = (points[i]! - x) ** 2 + (points[i + 1]! - y) ** 2 + (points[i + 2]! - z) ** 2;
    if (d < best) best = d;
  }
  return best;
}

/** Median over points of `a` of the distance to the nearest point of `b`. */
function medianGap(a: Float32Array, b: Float32Array, skipSelf: boolean): number {
  const d: number[] = [];
  for (let i = 0; i < a.length; i += 3) {
    let best = Infinity;
    for (let j = 0; j < b.length; j += 3) {
      if (skipSelf && i === j) continue;
      best = Math.min(best, (a[i]! - b[j]!) ** 2 + (a[i + 1]! - b[j + 1]!) ** 2 + (a[i + 2]! - b[j + 2]!) ** 2);
    }
    d.push(Math.sqrt(best));
  }
  d.sort((x, y) => x - y);
  return d[d.length >> 1]!;
}

/**
 * Trace each declared attractor from its known seed. Returns null (fall back
 * to a single attractor) if any seed escapes or collapses, or if two of them
 * end up on the same attractor, as happens when parameters or a coarse dt
 * merge them.
 */
function analyzeBasins(a: Attractor, p: readonly number[], dt: number): Analysis | null {
  const trajs = a.basins!.seeds.map((seed) => run(a, p, dt, seed));
  if (trajs.some((t) => !t)) return null;
  const probes = trajs.map((t) => subsample(t!.samples, PROBES));
  for (let i = 0; i < probes.length; i++) {
    const spacing = medianGap(probes[i]!, probes[i]!, true);
    for (let j = 0; j < probes.length; j++) {
      if (i !== j && medianGap(probes[i]!, probes[j]!, false) < 3 * spacing) return null;
    }
  }
  const total = trajs.reduce((n, t) => n + t!.speeds.length, 0);
  const samples = new Float32Array(total * 3);
  const speeds = new Float32Array(total);
  const sampleBasin = new Int8Array(total);
  let offset = 0;
  trajs.forEach((t, k) => {
    samples.set(t!.samples, offset * 3);
    speeds.set(t!.speeds, offset);
    sampleBasin.fill(k, offset, offset + t!.speeds.length);
    offset += t!.speeds.length;
  });
  const result = summarize(samples, speeds);
  if (isCollapsed(result)) return null;
  return { ...result, basins: { sampleBasin, probes } };
}

function percentile(sorted: Float32Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function axisRange(samples: Float32Array, axis: number, q: number): [number, number] {
  const v = new Float32Array(samples.length / 3);
  for (let i = 0; i < v.length; i++) v[i] = samples[3 * i + axis]!;
  v.sort();
  return [percentile(v, q), percentile(v, 1 - q)];
}

function summarize(samples: Float32Array, speeds: Float32Array): Analysis {
  const ranges = [0, 1, 2].map((axis) => axisRange(samples, axis, 0.01)) as [number, number][];
  const center = ranges.map(([a, b]) => (a + b) / 2) as Vec3;
  const radius = Math.max(0.5 * Math.hypot(...ranges.map(([a, b]) => b - a)), 1e-3);
  const sortedSpeeds = speeds.slice().sort();
  const speedLo = percentile(sortedSpeeds, 0.05);
  const speedHi = Math.max(percentile(sortedSpeeds, 0.95), speedLo + 1e-6);
  return {
    ok: true,
    collapsed: false,
    samples,
    center,
    radius,
    ranges,
    zRange: axisRange(samples, 2, 0.02),
    speedRange: [speedLo, speedHi],
  };
}
