import type { Attractor } from '../attractors';
import { analyze, type Analysis } from './analysis';
import { euler, type Integrator } from './integrators';

/** Upper bound on derivative evaluations per frame, so a tiny dt can't stall the tab. */
const MAX_EVALS_PER_FRAME = 3_000_000;
/** A particle further than this many attractor radii from the center has escaped. */
const ESCAPE_RADII = 50;
const STATS_SAMPLE = 256;

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
  /** Line-segment indices, segment-major. */
  index = new Uint32Array(0);
  /** Most recently written slot. */
  head = 0;

  analysis!: Analysis;
  /** Live robust ranges, eased toward the current distribution each frame. */
  speedRange: [number, number] = [0, 1];
  zRange: [number, number] = [0, 1];

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
   * positions (only their trails restart), so changing the count or trail
   * length doesn't visibly reset the simulation.
   */
  configure(count: number, trailLength: number) {
    const oldPos = this.pos;
    const oldCount = this.count;
    this.count = Math.max(1, Math.floor(count));
    this.trailLength = Math.max(2, Math.floor(trailLength));
    const verts = this.count * this.trailLength;
    this.pos = new Float32Array(this.count * 3);
    this.trail = new Float32Array(verts * 3);
    this.speed = new Float32Array(verts);
    this.index = new Uint32Array(verts * 2);
    this.version++;
    this.reseed(Math.min(oldCount, this.count), oldPos);
  }

  reanalyze() {
    this.analysis = analyze(this.attractor, this.params, this.dt);
    this.speedRange = [...this.analysis.speedRange];
    this.zRange = [...this.analysis.zRange];
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

  /** Place particles on the attractor; the first `keep` take their positions from `from` instead. */
  reseed(keep = 0, from?: Float32Array) {
    for (let i = 0; i < this.count; i++) {
      if (i < keep && from) this.placeAt(i, from[3 * i]!, from[3 * i + 1]!, from[3 * i + 2]!);
      else this.spawn(i);
    }
    this.head = 0;
    this.accumulator = 0;
    for (let k = 0; k < this.trailLength; k++) this.setSegment(k, k === 0);
    this.speedRange = [...this.analysis.speedRange];
    this.zRange = [...this.analysis.zRange];
    this.fullDirty = true;
    this.lastWrite = null;
  }

  /** Advance by `simTime` units of model time and record one trail slot. */
  advance(simTime: number) {
    const { count, dt, pos } = this;
    this.accumulator += simTime;
    let steps = Math.floor(this.accumulator / dt);
    this.accumulator -= steps * dt;
    steps = Math.min(steps, Math.max(1, Math.floor(MAX_EVALS_PER_FRAME / count)));
    if (steps <= 0) return;

    for (let s = 0; s < steps; s++) this.integrator(this.attractor.derivative, pos, count, this.params, dt);

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

  /** Place particle i at a random point on the reference trajectory and reset its trail. */
  private spawn(i: number) {
    const { samples, radius } = this.analysis;
    const n = samples.length / 3;
    const j = 3 * Math.floor(Math.random() * n);
    const jitter = radius * 0.004;
    const r = () => (Math.random() - 0.5) * jitter;
    this.placeAt(i, samples[j]! + r(), samples[j + 1]! + r(), samples[j + 2]! + r());
  }

  /** Put particle i at a point and collapse its whole trail onto it. */
  private placeAt(i: number, x: number, y: number, z: number) {
    this.pos[3 * i] = x;
    this.pos[3 * i + 1] = y;
    this.pos[3 * i + 2] = z;
    for (let s = 0; s < this.trailLength; s++) {
      const v = s * this.count + i;
      this.trail[3 * v] = this.pos[3 * i]!;
      this.trail[3 * v + 1] = this.pos[3 * i + 1]!;
      this.trail[3 * v + 2] = this.pos[3 * i + 2]!;
      this.speed[v] = this.analysis.speedRange[0];
    }
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
      z[k] = this.pos[3 * i + 2]!;
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
