import type { ParticleSystem } from './ParticleSystem';

/**
 * A Poincaré section: a plane perpendicular to one model axis, and the points
 * where particles cross it in one direction (increasing along the axis).
 * Plotting only those crossings turns a tangled 3D flow into a 2D picture: a
 * periodic loop becomes a single dot, a period-doubled loop two dots, and a
 * strange attractor a thin fractal curve, revealing its layered structure.
 *
 * Crossings are detected per rendered frame from each particle's previous and
 * current trail positions, with linear interpolation between them. That is
 * approximate when a particle moves far in one frame, but plenty for display.
 */
export class PoincareSection {
  axis: 0 | 1 | 2 = 2;
  offset = 0;
  /** Crossing points in model space, packed xyz, as a ring buffer. */
  readonly points: Float32Array;
  /** Number of valid points (≤ capacity). */
  count = 0;
  /** Next write position in the ring. */
  head = 0;
  /** Incremented on clear(), so views know to redraw from scratch. */
  version = 0;

  constructor(readonly capacity = 30_000) {
    this.points = new Float32Array(capacity * 3);
  }

  set(axis: 0 | 1 | 2, offset: number) {
    if (axis === this.axis && offset === this.offset) return;
    this.axis = axis;
    this.offset = offset;
    this.clear();
  }

  clear() {
    this.count = this.head = 0;
    this.version++;
  }

  /** Record this frame's crossings; call after advance() wrote a new slot. Returns how many. */
  collect(sys: ParticleSystem): number {
    const w = sys.lastWrite;
    if (!w) return 0;
    const { trail, count } = sys;
    const a = this.axis, c = this.offset;
    const cur = w.slot * count, prev = w.prevSlot * count;
    let found = 0;
    for (let i = 0; i < count; i++) {
      const p = 3 * (prev + i), q = 3 * (cur + i);
      const u = trail[p + a]! - c, v = trail[q + a]! - c;
      if (!(u < 0 && v >= 0)) continue;
      const t = u / (u - v);
      const o = 3 * this.head;
      for (let k = 0; k < 3; k++) this.points[o + k] = trail[p + k]! + t * (trail[q + k]! - trail[p + k]!);
      this.points[o + a] = c;
      this.head = (this.head + 1) % this.capacity;
      this.count = Math.min(this.count + 1, this.capacity);
      found++;
    }
    return found;
  }
}
