import * as THREE from 'three';
import type { Target } from './combat';
import { type Effects, rand, randomUnit } from './Effects';
import { glowTexture } from './JetView';

/** Seconds between bursts (random in this range), counted only while there is something to shoot. */
const WAIT: [number, number] = [15, 30];
/** After the wait, look this long for a target ahead of the nose before settling for any. */
const HUNT_SECONDS = 6;
/** A target counts as "ahead" within this angle of the nose. */
const AHEAD_COS = Math.cos(THREE.MathUtils.degToRad(55));
/** The GAU-8 fires about 65 rounds a second; every round here is a tracer, so fewer. */
const ROUNDS_PER_SECOND = 30;
const BURST_ROUNDS = 30;
/** Seconds a round takes to reach its aim point. */
const TRAVEL = 0.22;
/** A missed round keeps flying this long past its aim point. */
const OVERSHOOT = 0.35;
/** Hits that destroy a target. */
const KILL_HITS = 8;
/** Share of bursts that go wide and miss altogether. */
const MISS_CHANCE = 0.33;

const MAX_ROUNDS = 64;
/** Glowing dots per tracer streak, head first, and their brightness. */
const TRACER_DOTS = [1, 0.55, 0.3, 0.14];

interface Round {
  from: THREE.Vector3;
  /** Aim point relative to the target's centre, in target sizes. */
  offset: THREE.Vector3;
  target: Target;
  hits: boolean;
  age: number;
  /** Where the round was last frame and its velocity, for flying on after a miss. */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

export interface Gunship {
  /** Drawn this frame (visible and not shot down). */
  flying: boolean;
  muzzle(target?: THREE.Vector3): THREE.Vector3;
  forward(target?: THREE.Vector3): THREE.Vector3;
}

/**
 * The A-10's GAU-8 cannon: every so often the jet picks a target (one ahead
 * of the nose if it can), fires a short burst of glowing tracers at it, and
 * on enough hits blows it up. About a third of bursts go wide. The tracers
 * are additive points in the main scene so bloom makes them glow.
 */
export class CannonView {
  /** Add to Stage.scene. */
  readonly group = new THREE.Group();
  enabled = true;

  private wait = rand(...WAIT) * 0.5; // the first burst comes a bit sooner
  private hunting = 0;
  private burst: { target: Target; fired: number; clock: number; hits: number; miss: boolean; missDir: THREE.Vector3 } | null = null;
  private readonly rounds: Round[] = [];

  private readonly tracerGeom = new THREE.BufferGeometry();
  private readonly tracerMat: THREE.PointsMaterial;
  private readonly tracerPos = new Float32Array(MAX_ROUNDS * TRACER_DOTS.length * 3);
  private readonly tracerCol = new Float32Array(MAX_ROUNDS * TRACER_DOTS.length * 3);
  private tracerScale = 1;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(private readonly fx: Effects) {
    this.tracerGeom.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeom.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerMat = new THREE.PointsMaterial({
      map: glowTexture(),
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const tracers = new THREE.Points(this.tracerGeom, this.tracerMat);
    tracers.frustumCulled = false;
    this.group.add(tracers);
  }

  /** Stop any burst in progress and clear everything in flight (e.g. on an attractor switch). */
  reset() {
    this.burst = null;
    this.rounds.length = 0;
    this.hunting = 0;
    this.wait = rand(...WAIT);
  }

  /** Skip the rest of the wait: fire at the next chance. */
  fireSoon() {
    this.wait = 0;
  }

  /** Advance one frame. `paused` freezes the countdown but lets rounds in flight finish. */
  update(realDt: number, jet: Gunship, targets: readonly Target[], paused: boolean) {
    const dt = Math.min(realDt, 0.1);
    const armed = this.enabled && jet.flying && !paused;
    if (!armed) this.burst = null;
    else if (this.burst) this.fire(dt, jet, targets);
    else this.lookForTarget(dt, jet, targets);
    this.updateRounds(dt);
  }

  private lookForTarget(dt: number, jet: Gunship, targets: readonly Target[]) {
    const candidates = targets.filter((t) => t.alive());
    if (!candidates.length) return; // nothing to shoot: the countdown waits
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    this.hunting += dt;
    const muzzle = jet.muzzle(this.tmp);
    const forward = jet.forward(this.tmp2);
    const ahead = candidates.filter((t) => t.position().sub(muzzle).normalize().dot(forward) > AHEAD_COS);
    const pool = ahead.length ? ahead : this.hunting > HUNT_SECONDS ? candidates : [];
    if (!pool.length) return;
    const miss = Math.random() < MISS_CHANCE;
    this.burst = { target: pool[Math.floor(Math.random() * pool.length)]!, fired: 0, clock: 0, hits: 0, miss, missDir: randomUnit() };
    this.hunting = 0;
  }

  private fire(dt: number, jet: Gunship, targets: readonly Target[]) {
    const b = this.burst!;
    if (!b.target.alive() || !targets.includes(b.target)) {
      this.endBurst();
      return;
    }
    b.clock += dt;
    const muzzle = jet.muzzle(this.tmp);
    const size = b.target.size();
    while (b.fired < BURST_ROUNDS && b.clock * ROUNDS_PER_SECOND >= b.fired) {
      if (this.rounds.length >= MAX_ROUNDS) break;
      // Hitting bursts scatter a little (a few rounds still miss); missing ones go wide to one side.
      const offset = randomUnit().multiplyScalar(rand(0, b.miss ? 0.6 : 0.55));
      if (b.miss) offset.addScaledVector(b.missDir, rand(1.4, 2.6));
      this.rounds.push({
        from: muzzle.clone(),
        offset,
        target: b.target,
        hits: offset.length() < 0.45,
        age: 0,
        pos: muzzle.clone(),
        vel: new THREE.Vector3(),
      });
      b.fired++;
      // Muzzle flash, flickering with each round.
      this.fx.flash(muzzle, size * rand(0.5, 0.8), size * 0.2, 0.05, '#ffd08a', 2.5);
    }
    if (b.fired >= BURST_ROUNDS && !this.rounds.some((r) => r.target === b.target)) this.endBurst();
  }

  private endBurst() {
    this.burst = null;
    this.wait = rand(...WAIT);
  }

  private updateRounds(dt: number) {
    const aim = this.tmp;
    let n = 0;
    for (let k = this.rounds.length - 1; k >= 0; k--) {
      const r = this.rounds[k]!;
      r.age += dt;
      const prev = this.tmp2.copy(r.pos);
      if (r.age <= TRAVEL) {
        // Guided to the aim point as it moves with the target, so fast targets are still reachable.
        r.target.position(aim).addScaledVector(r.offset, r.target.size());
        r.pos.lerpVectors(r.from, aim, r.age / TRAVEL);
        r.vel.copy(r.pos).sub(prev).divideScalar(Math.max(dt, 1e-4));
      } else if (r.hits && this.burst?.target === r.target && r.target.alive()) {
        this.hit(r.target);
        this.rounds.splice(k, 1);
        continue;
      } else if (r.hits || r.age > TRAVEL + OVERSHOOT) {
        // A hit on a target that's already gone, or a miss that has flown far enough.
        this.rounds.splice(k, 1);
        continue;
      } else {
        r.pos.addScaledVector(r.vel, dt);
      }
      // Tracer streak: glowing dots trailing behind the round, dimming and reddening toward the tail.
      const fade = r.age > TRAVEL ? 1 - (r.age - TRAVEL) / OVERSHOOT : 1;
      const stride = Math.min(r.age / TRACER_DOTS.length, 0.016);
      TRACER_DOTS.forEach((b, d) => {
        const p = prev.copy(r.pos).addScaledVector(r.vel, -stride * d);
        const i = (n * TRACER_DOTS.length + d) * 3;
        this.tracerPos.set([p.x, p.y, p.z], i);
        this.tracerCol.set([3.2 * b * fade, 2.2 * b * b * fade, 0.9 * b * b * b * fade], i);
      });
      n++;
      this.tracerScale = r.target.size();
    }
    this.tracerMat.size = this.tracerScale * 0.3 * this.fx.pointScale;
    this.tracerCol.fill(0, n * TRACER_DOTS.length * 3);
    this.tracerGeom.setDrawRange(0, n * TRACER_DOTS.length);
    this.tracerGeom.attributes.position!.needsUpdate = true;
    this.tracerGeom.attributes.color!.needsUpdate = true;
  }

  private hit(target: Target) {
    const b = this.burst!;
    const at = target.position();
    const size = target.size();
    b.hits++;
    this.fx.impact(at, size);
    if (b.hits >= KILL_HITS) {
      this.fx.explode(at, size, target.photo());
      target.kill();
      b.fired = BURST_ROUNDS; // cease fire
    }
  }
}
