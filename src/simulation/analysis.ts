import type { Attractor, Vec3 } from '../attractors';

/**
 * A long single-particle reference run of the current system. Seeding particles
 * from points on this trajectory puts them on the attractor immediately (no
 * visible warm-up), and its statistics frame the camera and normalize colors.
 */
export interface Analysis {
  /** False if every attempt escaped to infinity; the rest is then a fallback. */
  readonly ok: boolean;
  /** Points on the attractor, packed xyz. */
  readonly samples: Float32Array;
  readonly center: Vec3;
  readonly radius: number;
  /** Robust (percentile) range of model-space z, for height coloring. */
  readonly zRange: [number, number];
  /** Robust range of |d(x,y,z)/dt|, for speed coloring. */
  readonly speedRange: [number, number];
}

const STEPS = 200_000;
const SAMPLES = 4096;
const ATTEMPTS = 8;
const ESCAPE = 1e6;
/** Radius (relative to 1 + |center|) below which a run is considered to have collapsed to a point. */
const COLLAPSED = 1e-2;

export function analyze(a: Attractor, p: readonly number[], dt: number): Analysis {
  const d: Vec3 = [0, 0, 0];
  const [lo, hi] = a.seedRange;
  const skip = STEPS >> 2;
  const stride = Math.max(1, Math.floor((STEPS - skip) / SAMPLES));
  // Some systems also have stable fixed points (Aizawa has one near
  // (0, 0, -1.3)); a run that lands there collapses to a dot. Retry those and
  // keep the widest result in case every attempt collapses.
  let best: Analysis | undefined;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let x = lo + Math.random() * (hi - lo);
    let y = lo + Math.random() * (hi - lo);
    let z = lo + Math.random() * (hi - lo);
    const samples = new Float32Array(SAMPLES * 3);
    const speeds = new Float32Array(SAMPLES);
    let n = 0;
    let escaped = false;

    for (let s = 0; s < STEPS && n < SAMPLES; s++) {
      a.derivative(x, y, z, p, d);
      x += dt * d[0];
      y += dt * d[1];
      z += dt * d[2];
      if (!(Math.abs(x) + Math.abs(y) + Math.abs(z) < ESCAPE)) {
        escaped = true;
        break;
      }
      if (s >= skip && (s - skip) % stride === 0) {
        samples[3 * n] = x;
        samples[3 * n + 1] = y;
        samples[3 * n + 2] = z;
        speeds[n] = Math.hypot(d[0], d[1], d[2]);
        n++;
      }
    }
    if (escaped) continue;
    const result = summarize(samples.subarray(0, n * 3), speeds.subarray(0, n));
    const scale = 1 + Math.hypot(...result.center);
    if (result.radius > COLLAPSED * scale) return result;
    if (!best || result.radius > best.radius) best = result;
  }
  if (best) return best;

  // Nothing bounded found (e.g. parameters dragged into a divergent regime).
  const samples = new Float32Array(SAMPLES * 3).map(() => lo + Math.random() * (hi - lo));
  return {
    ok: false,
    samples,
    center: [0, 0, 0],
    radius: Math.max(Math.abs(lo), Math.abs(hi)) * Math.sqrt(3),
    zRange: [lo, hi],
    speedRange: [0, 1],
  };
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
    samples,
    center,
    radius,
    zRange: axisRange(samples, 2, 0.02),
    speedRange: [speedLo, speedHi],
  };
}
