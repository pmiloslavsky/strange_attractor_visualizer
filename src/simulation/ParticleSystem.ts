import type { Attractor } from '../attractors';
import { analyze, nearest2, type Analysis } from './analysis';
import { euler, type Integrator } from './integrators';

/** Upper bound on derivative evaluations per frame, so a tiny dt can't stall the tab. */
const MAX_EVALS_PER_FRAME = 3_000_000;
/** A particle further than this many attractor radii from the center has escaped. */
const ESCAPE_RADII = 50;
const STATS_SAMPLE = 256;
/** Butterfly-demo cluster size, as a fraction of the attractor radius. */
const CLUSTER_SIZE = 1e-3;

/**
 * How reseed() places particles:
 * - 'attractor': scattered over the attractor (the default).
 * - 'cluster': all within a tiny ball at one point (butterfly-effect demo).
 * - 'region': spread over the system's basin region, each labeled with the
 *   attractor it will reach (systems with several attractors only).
 */
export type SeedMode = 'attractor' | 'cluster' | 'region';

/**
 * CPU-side particle + trail state. Framework-free: the Three.js view reads
 * these typed arrays directly and uploads only the ranges marked dirty.
 *
 * Trails are a ring buffer of `trailLength` slots, one slot per rendered frame,
 * stored slot-major (vertex = slot * count + particle). Writing one frame's
 * positions therefore touches a single contiguous range, which keeps GPU
 * uploads to count*3 floats per frame regardless of trail length.
 *
 * Trails are drawn as indexed line segments: segment k joins slot k to slot
 * k+1. The segment leaving the newest slot would join it to the oldest, so it
 * is collapsed to a point ("the break") and moves with the head.
 */
export class ParticleSystem {
  attractor: Attractor;
  params: number[];
  dt: number;
  integrator: Integrator = euler;

  count = 0;
  trailLength = 0;
  /** Current positions, packed xyz. */
  pos = new Float32Array(0);
  /** Trail positions, slot-major. */
  trail = new Float32Array(0);
  /** Speed at each trail vertex (for coloring). */
  speed = new Float32Array(0);
  /**
   * Which attractor each particle is on or headed for (index into
   * attractor.basins.seeds), or −1 when unknown or not applicable.
   */
  label = new Int8Array(0);
  /** `label` copied to every trail vertex, for "attractor" coloring. */
  basin = new Float32Array(0);
  /** Line-segment indices, segment-major. */
  index = new Uint32Array(0);
  /** Most recently written slot. */
  head = 0;

  analysis!: Analysis;
  /** Live robust ranges, eased toward the current distribution each frame. */
  speedRange: [number, number] = [0, 1];
  /** Range along heightAxis (named for the flows' usual z-up). */
  zRange: [number, number] = [0, 1];

  /** Model axis used for "height" coloring: z for flows, y for planar maps. */
  get heightAxis(): 1 | 2 {
    return this.attractor.kind === 'map' ? 1 : 2;
  }

  /** Incremented when buffers are reallocated (the view must rebuild). */
  version = 0;
  /** Whole trail buffer changed (reseed / respawn). Cleared by the view. */
  fullDirty = true;
  /** Set when advance() wrote a new slot; the view uploads it and clears it. */
  lastWrite: { slot: number; prevSlot: number } | null = null;

  private accumulator = 0;

  constructor(attractor: Attractor, count: number, trailLength: number) {
    this.attractor = attractor;
    this.params = [...attractor.examples[0]!];
    this.dt = attractor.dt;
    this.analysis = analyze(attractor, this.params, this.dt);
    this.configure(count, trailLength);
  }

  /** Integrator actually used: maps are an Euler step with dt = 1 by definition (see defineMap). */
  private get integrate(): Integrator {
    return this.attractor.kind === 'map' ? euler : this.integrator;
  }

  /** Switch system: default parameters and dt, fresh particles on the new attractor. */
  setAttractor(a: Attractor, params: readonly number[] = a.examples[0]!) {
    this.attractor = a;
    this.params = [...params];
    this.dt = a.dt;
    this.reanalyze();
    this.reseed();
  }

  /**
   * Change parameters live. Particles keep flowing. Pass `reanalyze: false`
   * while a slider is dragging or a preset is tweening, then call reanalyze()
   * once at the end: the reference run costs a few milliseconds.
   */
  setParams(params: readonly number[], reanalyze = true) {
    this.params = [...params];
    if (reanalyze) this.reanalyze();
  }

  /**
   * Resize the particle and trail buffers. Existing particles keep their
   * positions and labels (only their trails restart), so changing the count or
   * trail length doesn't visibly reset the simulation.
   */
  configure(count: number, trailLength: number) {
    const oldPos = this.pos;
    const oldLabel = this.label;
    const keep = Math.min(this.count, Math.max(1, Math.floor(count)));
    this.count = Math.max(1, Math.floor(count));
    this.trailLength = Math.max(2, Math.floor(trailLength));
    const verts = this.count * this.trailLength;
    this.pos = new Float32Array(this.count * 3);
    this.trail = new Float32Array(verts * 3);
    this.speed = new Float32Array(verts);
    this.basin = new Float32Array(verts);
    this.label = new Int8Array(this.count);
    this.index = new Uint32Array(verts * 2);
    this.version++;
    for (let i = 0; i < this.count; i++) {
      if (i < keep) this.placeAt(i, oldPos[3 * i]!, oldPos[3 * i + 1]!, oldPos[3 * i + 2]!, oldLabel[i]!);
      else this.spawn(i);
    }
    this.resetRing();
  }

  reanalyze() {
    this.analysis = analyze(this.attractor, this.params, this.dt);
    this.speedRange = [...this.analysis.speedRange];
    this.zRange = [...this.analysis.zRange];
    this.relabel();
  }

  /** Whether 'region' seeding (and attractor coloring) applies right now. */
  get hasBasins(): boolean {
    return !!this.analysis.basins && !!this.attractor.basins;
  }

  /**
   * Respawn particles further than `radii` attractor radii from its center.
   * Used after a parameter change so stragglers from the previous shape (or
   * from a divergent setting) don't take ages to find their way back.
   */
  respawnOutliers(radii: number) {
    const [cx, cy, cz] = this.analysis.center;
    const limit2 = (radii * this.analysis.radius) ** 2;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      const x = this.pos[3 * i]!, y = this.pos[3 * i + 1]!, z = this.pos[3 * i + 2]!;
      if (!((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < limit2)) {
        this.spawn(i);
        any = true;
      }
    }
    if (any) this.fullDirty = true;
  }

  /** Place every particle afresh (see SeedMode) and restart all trails. */
  reseed(mode: SeedMode = 'attractor') {
    if (mode === 'region' && !this.hasBasins) mode = 'attractor';
    if (mode === 'cluster') {
      const { samples, radius } = this.analysis;
      const j = 3 * Math.floor(Math.random() * (samples.length / 3));
      const label = this.analysis.basins?.sampleBasin[j / 3] ?? -1;
      const r = () => (Math.random() - 0.5) * radius * CLUSTER_SIZE;
      for (let i = 0; i < this.count; i++) {
        this.placeAt(i, samples[j]! + r(), samples[j + 1]! + r(), samples[j + 2]! + r(), label);
      }
    } else if (mode === 'region') {
      const { min, max } = this.attractor.basins!.region;
      for (let i = 0; i < this.count; i++) {
        const x = min[0] + Math.random() * (max[0] - min[0]);
        const y = min[1] + Math.random() * (max[1] - min[1]);
        const z = min[2] + Math.random() * (max[2] - min[2]);
        this.placeAt(i, x, y, z, this.destination(x, y, z));
      }
    } else {
      for (let i = 0; i < this.count; i++) this.spawn(i);
    }
    this.resetRing();
  }

  /** Advance by `simTime` units of model time and record one trail slot. */
  advance(simTime: number) {
    const { count, dt, pos } = this;
    this.accumulator += simTime;
    let steps = Math.floor(this.accumulator / dt);
    this.accumulator -= steps * dt;
    steps = Math.min(steps, Math.max(1, Math.floor(MAX_EVALS_PER_FRAME / count)));
    if (steps <= 0) return;

    const integrate = this.integrate;
    for (let s = 0; s < steps; s++) integrate(this.attractor.derivative, pos, count, this.params, dt);

    const prevSlot = this.head;
    const slot = (prevSlot + 1) % this.trailLength;
    const prevBase = prevSlot * count;
    const base = slot * count;
    const elapsed = steps * dt;
    const [cx, cy, cz] = this.analysis.center;
    const escape2 = (ESCAPE_RADII * this.analysis.radius) ** 2;

    for (let i = 0; i < count; i++) {
      const x = pos[3 * i]!, y = pos[3 * i + 1]!, z = pos[3 * i + 2]!;
      const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      if (!(d2 < escape2)) {
        this.spawn(i);
        this.fullDirty = true;
        continue;
      }
      const v = 3 * (base + i), pv = 3 * (prevBase + i);
      this.speed[base + i] =
        Math.hypot(x - this.trail[pv]!, y - this.trail[pv + 1]!, z - this.trail[pv + 2]!) / elapsed;
      this.basin[base + i] = this.label[i]!;
      this.trail[v] = x;
      this.trail[v + 1] = y;
      this.trail[v + 2] = z;
    }

    this.setSegment(prevSlot, false);
    this.setSegment(slot, true);
    this.head = slot;
    this.lastWrite = { slot, prevSlot };
    this.updateStats(base);
  }

  /**
   * Which attractor a start point leads to, found by running a copy of it
   * forward with the same integrator, dt and float32 storage as the live
   * particles, so the answer matches where the particle really goes. The copy
   * is checked every CHECK steps against each attractor's probe points and is
   * labeled once the same attractor is nearest, and close, several checks in
   * a row. Returns −1 if it hasn't settled within the step budget.
   */
  private destination(x: number, y: number, z: number): number {
    const basins = this.analysis.basins;
    if (!basins) return -1;
    const CHECK = 250, MAX_STEPS = 40_000, AGREE = 3;
    const near2 = (0.1 * this.analysis.radius) ** 2;
    const p = new Float32Array([x, y, z]);
    const integrate = this.integrate;
    let candidate = -1, streak = 0;
    for (let s = 1; s <= MAX_STEPS; s++) {
      integrate(this.attractor.derivative, p, 1, this.params, this.dt);
      if (s % CHECK) continue;
      if (!(Math.abs(p[0]!) + Math.abs(p[1]!) + Math.abs(p[2]!) < 1e6)) return -1;
      const k = this.nearestBasin(p[0]!, p[1]!, p[2]!, near2);
      streak = k >= 0 && k === candidate ? streak + 1 : k >= 0 ? 1 : 0;
      candidate = k;
      if (streak >= AGREE) return k;
    }
    return -1;
  }

  /** Index of the attractor whose probe points are nearest, if within `max2`; else −1. */
  private nearestBasin(x: number, y: number, z: number, max2 = Infinity): number {
    const probes = this.analysis.basins?.probes;
    if (!probes) return -1;
    let best = -1, bestD = max2;
    probes.forEach((pts, k) => {
      const d = nearest2(pts, x, y, z);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }

  /** After a parameter change: label each particle by the attractor it's nearest to now. */
  private relabel() {
    if (this.count === 0) return;
    for (let i = 0; i < this.count; i++) {
      this.label[i] = this.nearestBasin(this.pos[3 * i]!, this.pos[3 * i + 1]!, this.pos[3 * i + 2]!);
    }
    for (let s = 0; s < this.trailLength; s++) this.basin.set(this.label, s * this.count);
    this.fullDirty = true;
  }

  /** Place particle i at a random point on the reference trajectory and reset its trail. */
  private spawn(i: number) {
    const { samples, radius, basins } = this.analysis;
    const n = samples.length / 3;
    const k = Math.floor(Math.random() * n);
    const jitter = radius * 0.004;
    const r = () => (Math.random() - 0.5) * jitter;
    this.placeAt(i, samples[3 * k]! + r(), samples[3 * k + 1]! + r(), samples[3 * k + 2]! + r(), basins?.sampleBasin[k] ?? -1);
  }

  /** Put particle i at a point and collapse its whole trail onto it. */
  private placeAt(i: number, x: number, y: number, z: number, label: number) {
    this.pos[3 * i] = x;
    this.pos[3 * i + 1] = y;
    this.pos[3 * i + 2] = z;
    this.label[i] = label;
    for (let s = 0; s < this.trailLength; s++) {
      const v = s * this.count + i;
      this.trail[3 * v] = this.pos[3 * i]!;
      this.trail[3 * v + 1] = this.pos[3 * i + 1]!;
      this.trail[3 * v + 2] = this.pos[3 * i + 2]!;
      this.speed[v] = this.analysis.speedRange[0];
      this.basin[v] = label;
    }
  }

  /** Restart the ring buffer after particles were (re)placed. */
  private resetRing() {
    this.head = 0;
    this.accumulator = 0;
    for (let k = 0; k < this.trailLength; k++) this.setSegment(k, k === 0);
    this.speedRange = [...this.analysis.speedRange];
    this.zRange = [...this.analysis.zRange];
    this.fullDirty = true;
    this.lastWrite = null;
  }

  private setSegment(k: number, broken: boolean) {
    const { count, index } = this;
    const a = k * count;
    const b = broken ? a : ((k + 1) % this.trailLength) * count;
    for (let p = 0, o = 2 * a; p < count; p++, o += 2) {
      index[o] = a + p;
      index[o + 1] = b + p;
    }
  }

  /** Ease the color-normalization ranges toward the live distribution (5th–95th percentile). */
  private updateStats(base: number) {
    const n = Math.min(this.count, STATS_SAMPLE);
    const stride = this.count / n;
    const s = new Float32Array(n);
    const z = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const i = Math.floor(k * stride);
      s[k] = this.speed[base + i]!;
      z[k] = this.pos[3 * i + this.heightAxis]!;
    }
    s.sort();
    z.sort();
    const lo = Math.floor(n * 0.05), hi = Math.min(n - 1, Math.floor(n * 0.95));
    const ease = 0.03;
    const mix = (r: [number, number], a: number, b: number) => {
      r[0] += (a - r[0]) * ease;
      r[1] += (Math.max(b, a + 1e-6) - r[1]) * ease;
    };
    mix(this.speedRange, s[lo]!, s[hi]!);
    mix(this.zRange, z[lo]!, z[hi]!);
  }
}
