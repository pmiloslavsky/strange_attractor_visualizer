import type { Integrator } from './integrators';
import type { ParticleSystem } from './ParticleSystem';

/** Renormalizations per statistics block. */
const BLOCK = 20;
/** Renormalizations discarded at the start while the offset aligns with the most unstable direction. */
const WARMUP = 10;
/** Blocks needed before giving a verdict. */
const MIN_BLOCKS = 6;
/** Upper bound on integration steps per frame (two trajectories each). */
const MAX_STEPS_PER_FRAME = 4000;

export type ChaosVerdict = 'measuring' | 'chaotic' | 'periodic' | 'fixed point' | 'diverges';

export interface ChaosReading {
  verdict: ChaosVerdict;
  /** Largest Lyapunov exponent, per unit model time (flows) or per iteration (maps). */
  lambda: number;
  /** Standard error of `lambda`, from the spread of block estimates. */
  error: number;
  /** Time (or iterations) for a small separation to double: ln 2 / λ, when chaotic. */
  doubling: number;
  /** 'time unit' for flows, 'iteration' for maps. */
  unit: string;
}

/**
 * Live estimate of the largest Lyapunov exponent: how fast two nearly
 * identical states separate. Positive means chaotic (tiny differences grow
 * exponentially), zero means a periodic or quasi-periodic orbit, negative
 * means everything settles to a fixed point.
 *
 * Benettin's method: follow a reference trajectory and a companion offset
 * by d0. Every so often measure their separation d, add ln(d / d0) to a
 * running sum, and pull the companion back to distance d0 along the same
 * direction. λ = total log growth / total time. Runs in float64 with the same
 * equations, dt and integrator as the particles, restarting whenever any of
 * them change.
 */
export class LyapunovMeter {
  private ref = new Float64Array(3);
  private pert = new Float64Array(3);
  private d0 = 1e-8;
  private renormSteps = 1;
  private stepCount = 0;
  private renorms = 0;
  private logSum = 0;
  private time = 0;
  private block = 0;
  private blockTime = 0;
  private blocks: number[] = [];
  private diverged = false;
  private key = '';
  private integrator?: Integrator;

  constructor(private readonly sys: ParticleSystem) {}

  /** Advance the measurement a little; call once per frame. */
  tick() {
    const sys = this.sys;
    const key = `${sys.attractor.id}|${sys.params.join(',')}|${sys.dt}`;
    if (key !== this.key || sys.integrate !== this.integrator) this.reset(key);
    if (this.diverged || !sys.analysis.ok) return;

    const f = sys.attractor.derivative;
    const integrate = sys.integrate;
    const { dt, params } = sys;
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.max(this.renormSteps, Math.ceil(2 / dt)));
    for (let s = 0; s < steps; s++) {
      integrate(f, this.ref, 1, params, dt);
      integrate(f, this.pert, 1, params, dt);
      if (++this.stepCount < this.renormSteps) continue;
      this.stepCount = 0;
      const dx = this.pert[0]! - this.ref[0]!, dy = this.pert[1]! - this.ref[1]!, dz = this.pert[2]! - this.ref[2]!;
      const d = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(d) || !Number.isFinite(this.ref[0]!)) {
        this.diverged = true;
        return;
      }
      // A separation of exactly 0 (companion merged onto a fixed point) reads as strongly negative.
      const growth = Math.log(Math.max(d, Number.MIN_VALUE) / this.d0);
      const scale = d > 0 ? this.d0 / d : 1;
      this.pert[0] = this.ref[0]! + (d > 0 ? dx * scale : this.d0);
      this.pert[1] = this.ref[1]! + dy * scale;
      this.pert[2] = this.ref[2]! + dz * scale;
      if (++this.renorms <= WARMUP) continue;
      const span = this.renormSteps * dt;
      this.logSum += growth;
      this.time += span;
      this.block += growth;
      this.blockTime += span;
      if ((this.renorms - WARMUP) % BLOCK === 0) {
        this.blocks.push(this.block / this.blockTime);
        this.block = 0;
        this.blockTime = 0;
      }
    }
  }

  reading(): ChaosReading {
    const unit = this.sys.attractor.kind === 'map' ? 'iteration' : 'time unit';
    const base = { lambda: NaN, error: NaN, doubling: NaN, unit };
    if (this.diverged || !this.sys.analysis.ok) return { ...base, verdict: 'diverges' };
    const n = this.blocks.length;
    if (n < MIN_BLOCKS || this.time === 0) return { ...base, verdict: 'measuring' };
    const lambda = this.logSum / this.time;
    const mean = this.blocks.reduce((a, b) => a + b, 0) / n;
    const variance = this.blocks.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
    const error = Math.sqrt(variance / n);
    // "Clearly" nonzero means two standard errors plus a small absolute floor,
    // since a periodic orbit's estimate only approaches 0 slowly (like 1/time).
    const margin = 2 * error + 0.002;
    const verdict: ChaosVerdict = lambda > margin ? 'chaotic' : lambda < -margin ? 'fixed point' : 'periodic';
    return { verdict, lambda, error, doubling: lambda > 0 ? Math.LN2 / lambda : NaN, unit };
  }

  private reset(key: string) {
    const sys = this.sys;
    this.key = key;
    this.integrator = sys.integrate;
    this.diverged = false;
    this.stepCount = this.renorms = 0;
    this.logSum = this.time = this.block = this.blockTime = 0;
    this.blocks = [];
    const { samples, radius } = sys.analysis;
    const j = 3 * Math.floor(Math.random() * (samples.length / 3));
    this.ref.set(samples.subarray(j, j + 3));
    this.d0 = radius * 1e-7;
    // Random direction; the flow quickly turns it toward the most unstable one.
    const v = [Math.random() - 0.5, Math.random() - 0.5, sys.attractor.kind === 'map' ? 0 : Math.random() - 0.5];
    const len = Math.hypot(...v) || 1;
    for (let k = 0; k < 3; k++) this.pert[k] = this.ref[k]! + (v[k]! / len) * this.d0;
    // Renormalize about every half time unit for flows; every iteration for maps.
    this.renormSteps = sys.attractor.kind === 'map' ? 1 : Math.max(1, Math.round(0.5 / sys.dt));
  }
}
