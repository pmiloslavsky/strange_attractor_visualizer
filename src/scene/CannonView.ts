import * as THREE from 'three';
import { glowTexture } from './JetView';

/** Seconds between bursts (random in this range), counted only while there is something to shoot. */
const WAIT: [number, number] = [15, 30];
/** After the wait, look this long for a ball ahead of the nose before settling for any ball. */
const HUNT_SECONDS = 6;
/** A ball counts as "ahead" within this angle of the nose. */
const AHEAD_COS = Math.cos(THREE.MathUtils.degToRad(55));
/** The GAU-8 fires about 65 rounds a second; every round here is a tracer, so fewer. */
const ROUNDS_PER_SECOND = 30;
const BURST_ROUNDS = 30;
/** Seconds a round takes to reach its aim point. */
const TRAVEL = 0.22;
/** A missed round keeps flying this long past its aim point. */
const OVERSHOOT = 0.35;
/** Hits that destroy a ball. */
const KILL_HITS = 8;
/** Share of bursts that go wide and miss the ball altogether. */
const MISS_CHANCE = 0.33;

const MAX_ROUNDS = 64;
/** Glowing dots per tracer streak, head first, and their brightness. */
const TRACER_DOTS = [1, 0.55, 0.3, 0.14];
const MAX_SPARKS = 1200;
const MAX_FLASHES = 24;
const SHARDS = 12;

interface Round {
  from: THREE.Vector3;
  /** Aim point relative to the target ball's centre, in ball diameters. */
  offset: THREE.Vector3;
  target: number;
  hits: boolean;
  age: number;
  /** Where the round was last frame and its velocity, for flying on after a miss. */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  from: number;
  to: number;
  color: THREE.Color;
}

export interface CannonTargets {
  /** Whether ball `i` can be shot at right now. */
  isTarget(i: number): boolean;
  worldPosition(i: number, target?: THREE.Vector3): THREE.Vector3;
  worldSize(i: number): number;
  /** The ball's photo, for the shards it breaks into. */
  texture(i: number): THREE.Texture | null;
  count: number;
}

export interface CannonShooter {
  flying: boolean;
  muzzle(target?: THREE.Vector3): THREE.Vector3;
  forward(target?: THREE.Vector3): THREE.Vector3;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function randomUnit(target = new THREE.Vector3()): THREE.Vector3 {
  const z = rand(-1, 1), a = rand(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
  return target.set(r * Math.cos(a), r * Math.sin(a), z);
}

/**
 * The A-10's GAU-8 cannon: every so often the jet picks a photo ball (one
 * ahead of the nose if it can), fires a short burst of glowing tracers at it,
 * and on enough hits blows it up in a fireball with sparks and a shock ring.
 * About a third of bursts go wide. Everything is additive and drawn in the
 * main scene so bloom makes it glow. The caller hides the destroyed ball.
 */
export class CannonView {
  /** Add to Stage.scene. */
  readonly group = new THREE.Group();
  enabled = true;
  /** Called with the index of a ball when it is destroyed. */
  onKill?: (i: number) => void;

  private wait = rand(...WAIT) * 0.5; // the first burst comes a bit sooner
  private hunting = 0;
  private burst: { target: number; fired: number; clock: number; hits: number; miss: boolean; missDir: THREE.Vector3 } | null = null;
  private readonly rounds: Round[] = [];

  private readonly tracerGeom = new THREE.BufferGeometry();
  private readonly tracerMat: THREE.PointsMaterial;
  private readonly tracerPos = new Float32Array(MAX_ROUNDS * TRACER_DOTS.length * 3);
  private readonly tracerCol = new Float32Array(MAX_ROUNDS * TRACER_DOTS.length * 3);
  private tracerScale = 1;
  private pointScale = 1;

  private readonly shards: { sprite: THREE.Sprite; vel: THREE.Vector3; spin: number; age: number; life: number }[] = [];

  private readonly sparkGeom = new THREE.BufferGeometry();
  private readonly sparkMat: THREE.PointsMaterial;
  private readonly sparkPos = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkCol = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkVel = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkBase = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkLife = new Float32Array(MAX_SPARKS * 2); // age, life
  private nextSpark = 0;
  private sparkScale = 1;

  private readonly flashes: Flash[] = [];
  private readonly ring: THREE.Mesh;
  private ringAge = Infinity;
  private ringSize = 1;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor() {
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

    for (let i = 0; i < SHARDS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      sprite.visible = false;
      this.shards.push({ sprite, vel: new THREE.Vector3(), spin: 0, age: 1, life: 1 });
      this.group.add(sprite);
    }

    for (let i = 0; i < MAX_SPARKS; i++) this.sparkLife[2 * i] = this.sparkLife[2 * i + 1] = 1;
    this.sparkGeom.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkGeom.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkMat = new THREE.PointsMaterial({
      map: glowTexture(),
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const sparks = new THREE.Points(this.sparkGeom, this.sparkMat);
    sparks.frustumCulled = false;

    const glow = glowTexture();
    for (let i = 0; i < MAX_FLASHES; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
      );
      sprite.visible = false;
      this.flashes.push({ sprite, age: 1, life: 1, from: 1, to: 1, color: new THREE.Color() });
      this.group.add(sprite);
    }

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb070').multiplyScalar(1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.visible = false;
    this.group.add(tracers, sparks, this.ring);
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

  /**
   * Advance one frame. `exclude`: a ball not to shoot (the one the camera is
   * riding with). `paused` freezes the countdown but lets effects finish.
   */
  update(realDt: number, jet: CannonShooter, balls: CannonTargets, camera: THREE.Camera, exclude: number | null, paused: boolean) {
    const dt = Math.min(realDt, 0.1);
    const eligible = (i: number) => i !== exclude && balls.isTarget(i);
    const armed = this.enabled && jet.flying && !paused;

    if (!armed) this.burst = null;
    else if (this.burst) this.fire(dt, jet, balls, eligible);
    else this.lookForTarget(dt, jet, balls, eligible);

    // Points size in world units against half the viewport height, sprites against the
    // view's full vertical extent; this makes the two agree.
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    this.pointScale = 1 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    this.updateRounds(dt, balls);
    this.updateEffects(dt, camera);
  }

  private lookForTarget(dt: number, jet: CannonShooter, balls: CannonTargets, eligible: (i: number) => boolean) {
    const candidates = Array.from({ length: balls.count }, (_, i) => i).filter(eligible);
    if (!candidates.length) return; // nothing to shoot: the countdown waits
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    this.hunting += dt;
    const muzzle = jet.muzzle(this.tmp);
    const forward = jet.forward(this.tmp2);
    const ahead = candidates.filter((i) => {
      const to = balls.worldPosition(i).sub(muzzle).normalize();
      return to.dot(forward) > AHEAD_COS;
    });
    const pool = ahead.length ? ahead : this.hunting > HUNT_SECONDS ? candidates : [];
    if (!pool.length) return;
    const miss = Math.random() < MISS_CHANCE;
    this.burst = { target: pool[Math.floor(Math.random() * pool.length)]!, fired: 0, clock: 0, hits: 0, miss, missDir: randomUnit() };
    this.hunting = 0;
  }

  private fire(dt: number, jet: CannonShooter, balls: CannonTargets, eligible: (i: number) => boolean) {
    const b = this.burst!;
    if (!eligible(b.target)) {
      this.endBurst();
      return;
    }
    b.clock += dt;
    const muzzle = jet.muzzle(this.tmp);
    const size = balls.worldSize(b.target);
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
      this.flash(muzzle, size * rand(0.5, 0.8), size * 0.2, 0.05, '#ffd08a', 2.5);
    }
    if (b.fired >= BURST_ROUNDS && !this.rounds.some((r) => r.target === b.target)) this.endBurst();
  }

  private endBurst() {
    this.burst = null;
    this.wait = rand(...WAIT);
  }

  private updateRounds(dt: number, balls: CannonTargets) {
    const aim = this.tmp;
    let n = 0;
    for (let k = this.rounds.length - 1; k >= 0; k--) {
      const r = this.rounds[k]!;
      r.age += dt;
      const prev = this.tmp2.copy(r.pos);
      if (r.age <= TRAVEL) {
        // Guided to the aim point as it moves with the ball, so fast balls are still reachable.
        const size = balls.worldSize(r.target);
        balls.worldPosition(r.target, aim).addScaledVector(r.offset, size);
        r.pos.lerpVectors(r.from, aim, r.age / TRAVEL);
        r.vel.copy(r.pos).sub(prev).divideScalar(Math.max(dt, 1e-4));
      } else if (r.hits && this.burst?.target === r.target && balls.isTarget(r.target)) {
        this.hit(r.target, balls);
        this.rounds.splice(k, 1);
        continue;
      } else if (r.hits || r.age > TRAVEL + OVERSHOOT) {
        // A hit on a ball that's already gone, or a miss that has flown far enough.
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
        const k = (n * TRACER_DOTS.length + d) * 3;
        this.tracerPos.set([p.x, p.y, p.z], k);
        this.tracerCol.set([3.2 * b * fade, 2.2 * b * b * fade, 0.9 * b * b * b * fade], k);
      });
      n++;
      this.tracerScale = balls.worldSize(r.target);
    }
    this.tracerMat.size = this.tracerScale * 0.3 * this.pointScale;
    this.tracerCol.fill(0, n * TRACER_DOTS.length * 3);
    this.tracerGeom.setDrawRange(0, n * TRACER_DOTS.length);
    this.tracerGeom.attributes.position!.needsUpdate = true;
    this.tracerGeom.attributes.color!.needsUpdate = true;
  }

  private hit(i: number, balls: CannonTargets) {
    const b = this.burst!;
    const at = balls.worldPosition(i);
    const size = balls.worldSize(i);
    b.hits++;
    this.sparkScale = size;
    this.flash(at, size * 0.6, size * 0.2, 0.1, '#ffe2a0', 2);
    this.sparks(at, size, 5, 1.8, [3, 2, 0.8], 0.3);
    if (b.hits >= KILL_HITS) {
      this.explode(at, size, balls.texture(i));
      this.onKill?.(i);
      b.fired = BURST_ROUNDS; // cease fire
    }
  }

  private explode(at: THREE.Vector3, size: number, photo: THREE.Texture | null) {
    this.flash(at, size * 0.5, size * 1.8, 0.55, '#ffcf7a', 3);
    this.flash(at, size * 0.3, size * 1.1, 0.3, '#ffffff', 3.5);
    this.flash(at, size * 0.7, size * 2.4, 0.9, '#ff5a1a', 1.1);
    this.sparks(at, size, 160, 2.8, [4, 2.2, 0.7], 1.1);
    this.sparks(at, size, 80, 1.4, [3, 0.8, 0.2], 1.6);
    // The photo breaks into tumbling pieces.
    for (const s of this.shards) {
      if (!photo) break;
      s.sprite.material.map = photo;
      s.sprite.material.needsUpdate = true;
      s.sprite.position.copy(at).addScaledVector(randomUnit(), size * 0.25);
      s.sprite.scale.setScalar(size * rand(0.25, 0.4));
      s.sprite.visible = true;
      randomUnit(s.vel).multiplyScalar(size * rand(1.5, 3));
      s.spin = rand(-12, 12);
      s.age = 0;
      s.life = rand(1, 1.8);
    }
    this.ring.position.copy(at);
    this.ringSize = size;
    this.ringAge = 0;
  }

  private flash(at: THREE.Vector3, from: number, to: number, life: number, color: string, intensity: number) {
    // Reuse the oldest flash.
    const f = this.flashes.reduce((a, b) => (b.age / b.life > a.age / a.life ? b : a));
    f.sprite.position.copy(at);
    Object.assign(f, { age: 0, life, from, to });
    f.color.set(color).multiplyScalar(intensity);
    f.sprite.visible = true;
  }

  private sparks(at: THREE.Vector3, size: number, count: number, speed: number, rgb: [number, number, number], life: number) {
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const i = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % MAX_SPARKS;
      randomUnit(v).multiplyScalar(size * speed * rand(0.3, 1));
      this.sparkPos.set([at.x, at.y, at.z], 3 * i);
      this.sparkVel.set([v.x, v.y, v.z], 3 * i);
      const w = rand(0.6, 1.2);
      this.sparkBase.set([rgb[0] * w, rgb[1] * w, rgb[2] * w], 3 * i);
      this.sparkLife[2 * i] = 0;
      this.sparkLife[2 * i + 1] = life * rand(0.5, 1);
    }
  }

  private updateEffects(dt: number, camera: THREE.Camera) {
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        f.sprite.visible = false;
        continue;
      }
      f.sprite.scale.setScalar(f.from + (f.to - f.from) * (1 - (1 - k) ** 3));
      f.sprite.material.color.copy(f.color).multiplyScalar((1 - k) ** 2);
    }

    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < MAX_SPARKS; i++) {
      const age = (this.sparkLife[2 * i] = this.sparkLife[2 * i]! + dt);
      const life = this.sparkLife[2 * i + 1]!;
      if (age >= life) {
        this.sparkCol[3 * i] = this.sparkCol[3 * i + 1] = this.sparkCol[3 * i + 2] = 0;
        continue;
      }
      for (let a = 0; a < 3; a++) {
        this.sparkVel[3 * i + a]! *= drag;
        this.sparkPos[3 * i + a]! += this.sparkVel[3 * i + a]! * dt;
        // Fade out, reddening as they cool.
        const k = 1 - age / life;
        this.sparkCol[3 * i + a] = this.sparkBase[3 * i + a]! * k * (a === 0 ? 1 : k);
      }
    }
    this.sparkMat.size = this.sparkScale * 0.3 * this.pointScale;

    for (const s of this.shards) {
      if (!s.sprite.visible) continue;
      s.age += dt;
      const k = s.age / s.life;
      if (k >= 1) {
        s.sprite.visible = false;
        continue;
      }
      s.vel.multiplyScalar(drag);
      s.sprite.position.addScaledVector(s.vel, dt);
      s.sprite.material.rotation += s.spin * dt;
      s.sprite.material.opacity = 1 - k * k;
    }
    this.sparkGeom.attributes.position!.needsUpdate = true;
    this.sparkGeom.attributes.color!.needsUpdate = true;

    this.ringAge += dt;
    const k = this.ringAge / 0.6;
    this.ring.visible = k < 1;
    if (this.ring.visible) {
      this.ring.quaternion.copy(camera.quaternion);
      this.ring.scale.setScalar(this.ringSize * (0.4 + 1.6 * (1 - (1 - k) ** 2)));
      (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7;
    }
  }
}
