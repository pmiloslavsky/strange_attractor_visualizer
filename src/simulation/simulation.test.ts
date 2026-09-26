import { describe, expect, it } from 'vitest';
import { ATTRACTORS, getAttractor } from '../attractors';
import { analyze } from './analysis';
import { ParticleSystem } from './ParticleSystem';

describe('analyze', () => {
  it.each(ATTRACTORS.map((a) => [a.name, a] as const))(
    '%s finds a non-degenerate attractor every time',
    (_, a) => {
      for (let i = 0; i < 10; i++) {
        const r = analyze(a, a.examples[0]!, a.dt);
        expect(r.ok).toBe(true);
        expect(r.radius).toBeGreaterThan(0.1);
        expect(r.speedRange[1]).toBeGreaterThan(r.speedRange[0]);
      }
    },
  );
});

describe('Newton–Leipnik basins', () => {
  const nl = getAttractor('newton-leipnik');

  it('finds two distinct attractors at the default dt', () => {
    const r = analyze(nl, nl.examples[0]!, nl.dt);
    expect(r.basins?.probes).toHaveLength(2);
    // Upper attractor sits higher than the lower one.
    const meanZ = (pts: Float32Array) => { let s = 0; for (let i = 2; i < pts.length; i += 3) s += pts[i]!; return s / (pts.length / 3); };
    expect(meanZ(r.basins!.probes[0]!)).toBeGreaterThan(meanZ(r.basins!.probes[1]!) + 0.2);
  });

  it('falls back to a single attractor when a coarse dt merges them', () => {
    expect(analyze(nl, nl.examples[0]!, 0.01).basins).toBeUndefined();
  });

  it('labels region seeds with the attractor they actually reach', () => {
    const N = 200;
    const sys = new ParticleSystem(nl, N, 4);
    sys.reseed('region');
    const labels = Array.from(sys.label);
    expect(labels.filter((l) => l < 0).length).toBeLessThan(N * 0.02);
    expect(new Set(labels.filter((l) => l >= 0)).size).toBe(2); // both basins sampled
    // Run the real particles, then judge by mean height over a long window:
    // the attractors touch along a central spine, so a single instant can mislead.
    // Upper attractor (label 0) averages z ≈ +0.23, lower (1) ≈ −0.12.
    // Some particles bound for the upper one climb slowly (tens of time
    // units), so let them settle for 100 first and average over 40.
    for (let i = 0; i < 1000; i++) sys.advance(0.1);
    const zSum = new Float64Array(N);
    for (let i = 0; i < 400; i++) {
      sys.advance(0.1);
      for (let p = 0; p < N; p++) zSum[p] = zSum[p]! + sys.pos[3 * p + 2]!;
    }
    const wrong = labels.filter((l, p) => l >= 0 && (zSum[p]! / 400 > 0.06 ? 0 : 1) !== l).length;
    // A few particles (~0.2%) make a long transient visit near the lower
    // attractor (10–20 time units) before escaping to the upper one for good,
    // which fools the fast classifier. Catching those would mean following
    // every particle for 40+ time units, too slow for interactive seeding.
    expect(wrong).toBeLessThanOrEqual(N * 0.02);
  });
});

describe('butterfly cluster', () => {
  it('starts tight and spreads across the attractor', () => {
    const sys = new ParticleSystem(getAttractor('lorenz'), 200, 4);
    sys.reseed('cluster');
    const spread = () => {
      let max = 0;
      for (let i = 1; i < sys.count; i++) {
        max = Math.max(max, Math.hypot(sys.pos[3*i]! - sys.pos[0]!, sys.pos[3*i+1]! - sys.pos[1]!, sys.pos[3*i+2]! - sys.pos[2]!));
      }
      return max / sys.analysis.radius;
    };
    expect(spread()).toBeLessThan(0.002);
    for (let i = 0; i < 400; i++) sys.advance(0.1); // 40 time units
    expect(spread()).toBeGreaterThan(0.5);
  });
});

describe('ParticleSystem trail ring buffer', () => {
  const N = 5, L = 4;
  const make = () => new ParticleSystem(getAttractor('lorenz'), N, L);
  const segment = (sys: ParticleSystem, k: number, p: number) => [sys.index[2 * (k * N + p)], sys.index[2 * (k * N + p) + 1]];

  it('collapses exactly the segment leaving the head', () => {
    const sys = make();
    for (let frame = 0; frame < 2 * L + 1; frame++) {
      for (let k = 0; k < L; k++) {
        for (let p = 0; p < N; p++) {
          const [a, b] = segment(sys, k, p);
          expect(a).toBe(k * N + p);
          expect(b).toBe(k === sys.head ? k * N + p : ((k + 1) % L) * N + p);
        }
      }
      sys.advance(sys.dt * 3);
    }
  });

  it('writes the current positions into the head slot and reports it dirty', () => {
    const sys = make();
    sys.fullDirty = false;
    sys.advance(sys.dt * 2);
    expect(sys.lastWrite).toEqual({ slot: 1, prevSlot: 0 });
    expect(Array.from(sys.trail.subarray(N * 3, 2 * N * 3))).toEqual(Array.from(sys.pos));
  });

  it('keeps existing particle positions when resized', () => {
    const sys = make();
    sys.advance(sys.dt * 10);
    const before = Array.from(sys.pos);
    sys.configure(N + 3, L * 2);
    expect(Array.from(sys.pos.subarray(0, N * 3))).toEqual(before);
    // The new particle's trail is collapsed onto its position.
    const p = N + 2;
    for (let s = 0; s < sys.trailLength; s++) {
      const v = 3 * (s * sys.count + p);
      expect(Array.from(sys.trail.subarray(v, v + 3))).toEqual(Array.from(sys.pos.subarray(3 * p, 3 * p + 3)));
    }
  });

  it('respawns only particles far from the attractor', () => {
    const sys = make();
    const [cx, cy, cz] = sys.analysis.center;
    sys.pos.set([cx + 1000, cy, cz], 0);
    const kept = Array.from(sys.pos.subarray(3, 6));
    sys.fullDirty = false;
    sys.respawnOutliers(3);
    expect(Math.abs(sys.pos[0]! - cx)).toBeLessThan(3 * sys.analysis.radius);
    expect(Array.from(sys.pos.subarray(3, 6))).toEqual(kept);
    expect(sys.fullDirty).toBe(true);
  });

  it('does not write a slot when less than one step of time has accumulated', () => {
    const sys = make();
    sys.advance(sys.dt * 0.4);
    expect(sys.head).toBe(0);
    expect(sys.lastWrite).toBeNull();
  });
});
